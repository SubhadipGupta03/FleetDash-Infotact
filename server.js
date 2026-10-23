
require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const telemetryRouter = require("./routes/telemetry");
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

startServer();
