
require("dotenv").config();

const { io } = require("socket.io-client");
const { randomUUID } = require("node:crypto");

const BASE_URL = process.env.BASE_URL || "http://localhost:5001";
const SOCKET_URL = BASE_URL;
const TIMEOUT_MS = 10000;

function decodeTelemetry(payload) {
  let text;

  if (Buffer.isBuffer(payload)) {
    text = payload.toString("utf8");
  } else if (payload instanceof ArrayBuffer) {
    text = Buffer.from(payload).toString("utf8");
  } else if (ArrayBuffer.isView(payload)) {
    text = Buffer.from(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength
    ).toString("utf8");
  } else if (
    payload &&
    payload.type === "Buffer" &&
    Array.isArray(payload.data)
  ) {
    text = Buffer.from(payload.data).toString("utf8");
  } else if (typeof payload === "string") {
    text = payload;
  } else {
    throw new Error("Unsupported telemetry payload format");
  }

  return JSON.parse(text);
}

function waitForTelemetry(socket, expectedEventId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("telemetry-update", onTelemetry);
      reject(
        new Error(`Timed out waiting for ${expectedEventId}`)
      );
    }, TIMEOUT_MS);

    function onTelemetry(payload) {
      try {
        const telemetry = decodeTelemetry(payload);

        if (telemetry.eventId !== expectedEventId) {
          return;
        }

        clearTimeout(timer);
        socket.off("telemetry-update", onTelemetry);
        resolve(telemetry);
      } catch (error) {
        clearTimeout(timer);
        socket.off("telemetry-update", onTelemetry);
        reject(error);
      }
    }

    socket.on("telemetry-update", onTelemetry);
  });
}

async function postTelemetry(eventId) {
  const response = await fetch(
    `${BASE_URL}/api/telemetry/ingest`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": eventId,
      },
      body: JSON.stringify({
        eventId,
        vehicleId: `VH-RECOVERY-${randomUUID()}`,
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      }),
    }
  );

  const body = await response.json();

  if (!response.ok || body.success !== true) {
    throw new Error(
      `Ingestion failed (${response.status}): ${JSON.stringify(body)}`
    );
  }

  return body;
}

async function main() {
  const clients = [
    io(SOCKET_URL, { transports: ["websocket"] }),
    io(SOCKET_URL, { transports: ["websocket"] }),
  ];

  try {
    await Promise.all(
      clients.map(
        (socket) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              socket.off("connect", onConnect);
              socket.off("connect_error", onError);
              reject(new Error("Socket connection timed out"));
            }, TIMEOUT_MS);

            function onConnect() {
              clearTimeout(timer);
              socket.off("connect_error", onError);
              resolve();
            }

            function onError(error) {
              clearTimeout(timer);
              socket.off("connect", onConnect);
              reject(error);
            }

            socket.once("connect", onConnect);
            socket.once("connect_error", onError);
          })
      )
    );

    console.log("PASS: Both Socket.IO clients connected");

    // Prove telemetry delivery before recovery.
    const beforeId = `recovery-before-${randomUUID()}`;
    const beforeWaits = clients.map((socket) =>
      waitForTelemetry(socket, beforeId)
    );

    await postTelemetry(beforeId);
    await Promise.all(beforeWaits);

    console.log("PASS: Both clients received telemetry before recovery");

    // This reconnects the isolated server's actual Redis subscriber.
    const recoveryResponse = await fetch(
      `${BASE_URL}/__test/redis-subscriber-reconnect`,
      { method: "POST" }
    );

    const recovery = await recoveryResponse.json();

    if (
      !recoveryResponse.ok ||
      recovery.success !== true ||
      recovery.automaticRecoveryObserved !== true
    ) {
      throw new Error(
        `Automatic recovery failed: ${JSON.stringify(recovery)}`
      );
    }

    console.log(
      `PASS: Automatic subscriber recovery completed (count ${recovery.recoveryCount})`
    );

    // Prove the recovered subscriber forwards a new event to both clients.
    const afterId = `recovery-after-${randomUUID()}`;
    const afterWaits = clients.map((socket) =>
      waitForTelemetry(socket, afterId)
    );

    await postTelemetry(afterId);
    const received = await Promise.all(afterWaits);

    if (
      received.some(
        (telemetry) => telemetry.eventId !== afterId
      )
    ) {
      throw new Error("Clients received unexpected telemetry");
    }

    console.log("PASS: Client 1 received telemetry after recovery");
    console.log("PASS: Client 2 received telemetry after recovery");
    console.log("PASS: Production recovery path verified on port 5001");
  } finally {
    for (const socket of clients) {
      socket.disconnect();
    }
  }
}

main().catch((error) => {
  console.error("FAIL:", error.message);
  process.exitCode = 1;
});
