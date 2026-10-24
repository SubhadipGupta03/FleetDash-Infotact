const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:5000";
const vehicleId = `VH-RECONNECT-${Date.now()}`;

const socket = io(SERVER_URL, {
  reconnection: false,
  timeout: 5000,
});

let initialConnection = false;
let requestSent = false;
let finished = false;
let timeout;

function finish(status, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  socket.close();
  console.log(`${status}: ${message}`);
  process.exitCode = status === "PASS" ? 0 : 1;
}

timeout = setTimeout(() => {
  finish("FAIL", "Timed out waiting for telemetry after reconnect");
}, 15000);

socket.on("connect", async () => {
  if (!initialConnection) {
    initialConnection = true;
    console.log("PASS: Initial connection established");

    socket.disconnect();
    console.log("Client disconnected intentionally");

    setTimeout(() => socket.connect(), 500);
    return;
  }

  if (!requestSent) {
    requestSent = true;
    console.log("PASS: Client reconnected successfully");

    try {
      const response = await fetch(
        `${SERVER_URL}/api/telemetry/ingest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId,
            latitude: 28.6139,
            longitude: 77.2090,
            timestamp: new Date().toISOString(),
          }),
        }
      );

      const result = await response.json();
      console.log("Ingestion HTTP status:", response.status);

      if (!response.ok || result.success !== true) {
        finish("FAIL", "Telemetry ingestion failed");
      }
    } catch (error) {
      finish("FAIL", error.message);
    }
  }
});

socket.on("telemetry-update", (payload) => {
  try {
    const isBinary =
      Buffer.isBuffer(payload) ||
      payload instanceof ArrayBuffer ||
      ArrayBuffer.isView(payload);

    if (!isBinary) {
      throw new Error("Telemetry payload was not binary");
    }

    const bytes = Buffer.isBuffer(payload)
      ? payload
      : payload instanceof ArrayBuffer
        ? Buffer.from(payload)
        : Buffer.from(
            payload.buffer,
            payload.byteOffset,
            payload.byteLength
          );

    const telemetry = JSON.parse(bytes.toString("utf8"));

    if (telemetry.vehicleId !== vehicleId) return;

    console.log("PASS: Telemetry received after reconnect");
    console.log("PASS: Payload is binary");
    finish("PASS", "Reconnect and telemetry delivery verified");
  } catch (error) {
    finish("FAIL", error.message);
  }
});

socket.on("connect_error", (error) => {
  finish("FAIL", `Socket connection error: ${error.message}`);
});
