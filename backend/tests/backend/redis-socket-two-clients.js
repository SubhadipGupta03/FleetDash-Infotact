const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:5000";
const vehicleId = `VH-WEEK2-TWO-CLIENTS-${Date.now()}`;
const clients = [io(SERVER_URL), io(SERVER_URL)];
const received = [false, false];
let requestSent = false;
let finished = false;

const timeout = setTimeout(() => {
  finish("FAIL", "Timed out waiting for both clients");
}, 15000);

function finish(status, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  clients.forEach((client) => client.close());
  console.log(`${status}: ${message}`);
  process.exitCode = status === "PASS" ? 0 : 1;
}

async function sendTelemetryWhenReady() {
  if (requestSent || !clients.every((client) => client.connected)) return;
  requestSent = true;

  try {
    const response = await fetch(`${SERVER_URL}/api/telemetry/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleId,
        latitude: 28.6139,
        longitude: 77.2090,
        timestamp: new Date().toISOString(),
      }),
    });

    const result = await response.json();
    console.log("Ingestion HTTP status:", response.status);

    if (!response.ok || !result.success) {
      finish("FAIL", "Telemetry ingestion failed");
    }
  } catch (error) {
    finish("FAIL", error.message);
  }
}

clients.forEach((client, index) => {
  client.on("connect", () => {
    console.log(`Client ${index + 1} connected`);
    sendTelemetryWhenReady();
  });

  client.on("telemetry-update", (payload) => {
    try {
      const bytes = Buffer.isBuffer(payload)
        ? payload
        : payload instanceof ArrayBuffer
          ? Buffer.from(payload)
          : ArrayBuffer.isView(payload)
            ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
            : null;

      if (!bytes) throw new Error("Payload was not binary");

      const telemetry = JSON.parse(bytes.toString("utf8"));
      if (telemetry.vehicleId !== vehicleId) return;

      received[index] = true;
      console.log(`PASS: Client ${index + 1} received binary telemetry`);

      if (received.every(Boolean)) {
        finish("PASS", "Both clients received the same telemetry update");
      }
    } catch (error) {
      finish("FAIL", error.message);
    }
  });

  client.on("connect_error", (error) => {
    finish("FAIL", `Client ${index + 1}: ${error.message}`);
  });
});
