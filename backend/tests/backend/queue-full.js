require("dotenv").config();
process.env.NODE_ENV = "test";
process.env.TELEMETRY_WORKERS = "1";
process.env.TELEMETRY_WORKER_MAX_QUEUE = "1";
const {
  connectRedis,
  publisher,
  subscriber,
} = require("../../config/redisClient");
const express = require("express");
const http = require("node:http");
const telemetryRouter = require("../../routes/telemetry");
const { connectDatabase, closeDatabase } = require("../../config/database");

const { ensureTelemetryIndexes } = require("../../config/telemetryBuckets");

const {
  closeTelemetryWorkerPool,
} = require("../../config/telemetryWorkerPool");

const app = express();
app.use(express.json());

app.get("/health-test", (req, res) => {
  res.status(200).json({ success: true });
});

app.use("/api/telemetry", telemetryRouter);

const server = http.createServer(app);

function postTelemetry(port, vehicleId) {
  return new Promise((resolve, reject) => {

const body = JSON.stringify({
  eventId: `event-${vehicleId}`,
  vehicleId,
  latitude: 28.6139,
  longitude: 77.209,
  timestamp: new Date().toISOString(),
});


    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/telemetry/ingest",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let responseBody = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });

        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: responseBody,
          });
        });
      },
    );

    req.on("error", reject);
    req.end(body);
  });
}

async function runTest() {
  let exitCode = 0;

  try {
    await connectDatabase();
    await ensureTelemetryIndexes();
    await connectRedis();

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    // Send requests together so the single worker has work in progress
    // while the one-slot queue fills.
    const results = await Promise.all([
      postTelemetry(port, "VH-QUEUE-TEST-1"),
      postTelemetry(port, "VH-QUEUE-TEST-2"),
      postTelemetry(port, "VH-QUEUE-TEST-3"),
    ]);

    results.forEach((result, index) => {
      console.log(`Request ${index + 1}: HTTP ${result.status} ${result.body}`);
    });

    const overloaded = results.find((result) => result.status === 503);

    if (
      overloaded &&
      JSON.parse(overloaded.body).error === "Telemetry processing queue is full"
    ) {
      console.log("PASS: Queue overload returned the expected HTTP 503");
    } else {
      console.error("FAIL: Expected queue-full HTTP 503 was not observed");
      exitCode = 1;
    }
    const healthResponse = await fetch(`http://127.0.0.1:${port}/health-test`);

    if (healthResponse.status === 200) {
      console.log("PASS: Server remains responsive after queue overload");
    } else {
      console.error("FAIL: Server did not respond successfully after overload");
      exitCode = 1;
    }
  } catch (error) {
    console.error("Queue-full test failed:", error.message);
    exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeTelemetryWorkerPool();

    if (publisher.isOpen) await publisher.quit();
    if (subscriber.isOpen) await subscriber.quit();

    await closeDatabase();
    console.log(
      "Isolated test server, worker pool, Redis, and database closed",
    );
  }

  if (exitCode !== 0) process.exitCode = exitCode;
}

runTest();
