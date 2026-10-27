
require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const telemetryRouter = require("./routes/telemetry");
const {
  closeTelemetryWorkerPool,
} = require("./config/telemetryWorkerPool");
const {
  connectDatabase,
  closeDatabase,
} = require("./config/database");
const {
  ensureTelemetryIndexes,
} = require("./config/telemetryBuckets");
const {
  connectRedis,
  publisher,
  subscriber,
} = require("./config/redisClient");
const { setSocketServer } = require("./config/socket");

const PORT = Number.parseInt(process.env.PORT || "5000", 10);
const TELEMETRY_CHANNEL = "fleetdash:telemetry";

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

setSocketServer(io);

app.use(express.json({ limit: "64kb" }));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "FleetDash backend is running",
  });
});

app.use("/api/telemetry", telemetryRouter);

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: "Request body is too large",
    });
  }

  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      success: false,
      error: "Invalid JSON request body",
    });
  }

  console.error("HTTP request error:", error.message);

  return res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.emit("connection-status", {
    success: true,
    message: "Connected to FleetDash real-time server",
  });

  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${reason})`);
  });
});


let telemetrySubscriptionInitialized = false;
let telemetryRecoveryPromise = null;
let automaticRecoveryCount = 0;
const recoveryWaiters = new Set();

async function subscribeToTelemetry() {
  if (telemetryRecoveryPromise) {
    return telemetryRecoveryPromise;
  }

  telemetryRecoveryPromise = (async () => {
    await subscriber.subscribe(TELEMETRY_CHANNEL, (message) => {
      try {
        const telemetry = JSON.parse(message);
        const binaryPayload = Buffer.from(
          JSON.stringify(telemetry),
          "utf8"
        );

        io.emit("telemetry-update", binaryPayload);
      } catch (error) {
        console.error(
          "Invalid telemetry message from Redis:",
          error.message
        );
      }
    });

    telemetrySubscriptionInitialized = true;
    console.log(`Subscribed to ${TELEMETRY_CHANNEL}`);
  })();

  try {
    await telemetryRecoveryPromise;
  } finally {
    telemetryRecoveryPromise = null;
  }
}

function waitForAutomaticRecovery(afterCount, timeoutMs = 8000) {
  if (automaticRecoveryCount > afterCount) {
    return Promise.resolve(automaticRecoveryCount);
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: null,
    };

    waiter.timer = setTimeout(() => {
      recoveryWaiters.delete(waiter);
      reject(
        new Error("Timed out waiting for automatic subscription recovery")
      );
    }, timeoutMs);

    recoveryWaiters.add(waiter);
  });
}

function recordAutomaticRecovery() {
  automaticRecoveryCount += 1;

  for (const waiter of recoveryWaiters) {
    clearTimeout(waiter.timer);
    recoveryWaiters.delete(waiter);
    waiter.resolve(automaticRecoveryCount);
  }
}

subscriber.on("connect", () => {
  if (!telemetrySubscriptionInitialized) {
    return;
  }

  console.log(
    "Redis subscriber ready; restoring telemetry subscription"
  );

  void subscribeToTelemetry()
    .then(() => {
      recordAutomaticRecovery();
    })
    .catch((error) => {
      console.error(
        "Failed to restore telemetry subscription:",
        error.message
      );
    });
});

// Test-only recovery control. Disabled by default.
if (process.env.FLEETDASH_TEST_CONTROLS === "true") {
  app.post("/__test/redis-subscriber-reconnect", async (req, res) => {
    const remoteAddress = req.socket.remoteAddress;

    const isLoopback = [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
    ].includes(remoteAddress);

    if (!isLoopback) {
      return res.status(403).json({
        success: false,
        error: "Local requests only",
      });
    }

    const previousRecoveryCount = automaticRecoveryCount;

    try {
      if (subscriber.isOpen) {
        await subscriber.disconnect();
      }

      await subscriber.connect();

      // Wait for the automatic "ready" listener to complete
      // subscription recovery. Do not subscribe manually here.
      const recoveryCount = await waitForAutomaticRecovery(
        previousRecoveryCount
      );

      if (!subscriber.isReady) {
        throw new Error("Redis subscriber is not ready");
      }

      return res.status(200).json({
        success: true,
        subscriberReady: subscriber.isReady,
        automaticRecoveryObserved: true,
        recoveryCount,
      });
    } catch (error) {
      console.error(
        "Test-only subscriber recovery failed:",
        error.message
      );

      return res.status(500).json({
        success: false,
        error: "Automatic subscriber recovery failed",
      });
    }
  });
}



let shutdownPromise = null;

async function closeRedisClient(client, name) {
  if (!client?.isOpen) {
    return;
  }

  try {
    await client.quit();
  } catch (error) {
    console.error(`Error closing Redis ${name}:`, error.message);

    try {
      client.destroy();
    } catch (destroyError) {
      console.error(
        `Error destroying Redis ${name}:`,
        destroyError.message
      );
    }
  }
}

async function cleanupResources() {
  await new Promise((resolve) => {
    io.close(() => resolve());
  });

  await closeTelemetryWorkerPool();

  await closeRedisClient(subscriber, "subscriber");
  await closeRedisClient(publisher, "publisher");

  await closeDatabase();
}

async function startServer() {
  try {
    await connectDatabase();
    await ensureTelemetryIndexes();
    await connectRedis();

    await subscribeToTelemetry();

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        httpServer.off("listening", onListening);
        reject(error);
      };

      const onListening = () => {
        httpServer.off("error", onError);
        resolve();
      };

      httpServer.once("error", onError);
      httpServer.once("listening", onListening);

      httpServer.listen(PORT);
    });

    console.log(`FleetDash server running on port ${PORT}`);
    console.log("Socket.IO server is ready");
  } catch (error) {
    console.error("Failed to start FleetDash:", error.message);

    try {
      await cleanupResources();
    } catch (cleanupError) {
      console.error(
        "Startup cleanup failed:",
        cleanupError.message
      );
    }

    process.exitCode = 1;
  }
}

function shutdown(signal = "shutdown") {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.log(`Shutting down FleetDash (${signal})...`);

    try {
      await cleanupResources();
      console.log("FleetDash shutdown complete");
    } catch (error) {
      console.error("Error during shutdown:", error.message);
      process.exitCode = 1;
    }
  })();

  return shutdownPromise;
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

startServer();

module.exports = {
  app,
  httpServer,
  io,
  startServer,
  shutdown,
};
