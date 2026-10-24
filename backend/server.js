require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const telemetryRouter = require("./routes/telemetry");
const { closeTelemetryWorkerPool } = require("./config/telemetryWorkerPool");
const { connectDatabase } = require("./config/database");
const { ensureTelemetryIndexes } = require("./config/telemetryBuckets");
const { connectRedis, publisher, subscriber } = require("./config/redisClient");

const app = express();
const httpServer = http.createServer(app);
const { setSocketServer } = require("./config/socket");

const PORT = process.env.PORT || 5000;

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
setSocketServer(io);

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "FleetDash backend is running",
  });
});

app.use("/api/telemetry", telemetryRouter);

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

async function startServer() {
  try {
    await connectDatabase();
    await ensureTelemetryIndexes();
    await connectRedis();
    await subscriber.subscribe("fleetdash:telemetry", (message) => {

  try {
    const telemetry = JSON.parse(message);
    const binaryPayload = Buffer.from(JSON.stringify(telemetry));
    io.emit("telemetry-update",  binaryPayload);
  } catch (error) {
    console.error("Invalid telemetry message from Redis:", error.message);
  }
});

console.log("Subscribed to fleetdash:telemetry");

    httpServer.listen(PORT, () => {
      console.log(`FleetDash server running on port ${PORT}`);
      console.log("Socket.IO server is ready");
    });
  } catch (error) {
    console.error("Failed to start FleetDash:", error.message);
    process.exit(1);
  }
}

let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("Shutting down FleetDash...");

  try {
    await new Promise((resolve) => {
      io.close(resolve);
    });

    await closeTelemetryWorkerPool();
    await publisher.quit();
    await subscriber.quit();

    console.log("FleetDash shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error.message);
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startServer();


