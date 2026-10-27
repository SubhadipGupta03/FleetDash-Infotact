
const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:5000";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const vehicleId = `VH-WEEK2-TWO-CLIENTS-${runId}`;
const eventId = `EV-WEEK2-TWO-CLIENTS-${runId}`;

const clients = [
  io(SERVER_URL, { transports: ["websocket"] }),
  io(SERVER_URL, { transports: ["websocket"] }),
];

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
        eventId,
        vehicleId,
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      }),
    });

    const result = await response.json();
    console.log("Ingestion HTTP status:", response.status);

    if (!response.ok || !result.success) {
      finish(
        "FAIL",
        `Telemetry ingestion failed: ${result.error || response.statusText}`,
      );
      return;
    }

    console.log("Ingestion accepted:", result.success);
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
      let bytes;

      if (Buffer.isBuffer(payload)) {
        bytes = payload;
      } else if (payload instanceof ArrayBuffer) {
        bytes = Buffer.from(payload);
      } else if (ArrayBuffer.isView(payload)) {
        bytes = Buffer.from(
          payload.buffer,
          payload.byteOffset,
          payload.byteLength,
        );
      } else if (
        payload &&
        payload.type === "Buffer" &&
        Array.isArray(payload.data)
      ) {
        bytes = Buffer.from(payload.data);
      } else {
        throw new Error("Payload was not binary");
      }

      const telemetry = JSON.parse(bytes.toString("utf8"));

      if (telemetry.eventId !== eventId) return;

      if (telemetry.vehicleId !== vehicleId) {
        throw new Error("Received event has an unexpected vehicleId");
      }

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
