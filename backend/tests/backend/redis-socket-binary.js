const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:5000";
const vehicleId = `VH-WEEK2-BINARY-${Date.now()}`;

const socket = io(SERVER_URL, {
  reconnection: false,
  timeout: 5000,
});

const timeout = setTimeout(() => {
  console.error("FAIL: Timed out waiting for binary telemetry update");
  socket.close();
  process.exit(1);
}, 10000);

socket.on("connect", async () => {
  console.log("PASS: Socket.IO client connected");

  try {
    const response = await fetch(`${SERVER_URL}/api/telemetry/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
  eventId: `event-${vehicleId}`,
  vehicleId,
  latitude: 28.6139,
  longitude: 77.2090,
  timestamp: new Date().toISOString(),
}),
    });

    const result = await response.json();
    console.log("Ingestion HTTP status:", response.status);

    if (!response.ok || result.success !== true) {
      throw new Error(`Ingestion failed: ${JSON.stringify(result)}`);
    }

    console.log("PASS: Telemetry ingestion succeeded");
  } catch (error) {
    clearTimeout(timeout);
    console.error("FAIL:", error.message);
    socket.close();
    process.exit(1);
  }
});

socket.on("telemetry-update", (payload) => {
  try {
    const isBinary =
      Buffer.isBuffer(payload) ||
      payload instanceof ArrayBuffer ||
      ArrayBuffer.isView(payload);

    if (!isBinary) {
      throw new Error(
        `Expected binary payload, received ${payload?.constructor?.name || typeof payload}`
      );
    }

    const bytes = Buffer.isBuffer(payload)
      ? payload
      : payload instanceof ArrayBuffer
        ? Buffer.from(payload)
        : Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);

    const telemetry = JSON.parse(bytes.toString("utf8"));

    if (telemetry.vehicleId !== vehicleId) {
      console.log("Ignoring telemetry for another vehicle");
      return;
    }

    console.log("PASS: Received telemetry-update as binary data");
    console.log("Payload type:", payload.constructor.name);
    console.log("Decoded vehicleId:", telemetry.vehicleId);

    clearTimeout(timeout);
    socket.close();
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error("FAIL:", error.message);
    socket.close();
    process.exit(1);
  }
});

socket.on("connect_error", (error) => {
  clearTimeout(timeout);
  console.error("FAIL: Socket connection error:", error.message);
  socket.close();
  process.exit(1);
});
