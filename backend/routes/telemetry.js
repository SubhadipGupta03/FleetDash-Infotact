const { performance } = require("node:perf_hooks");
const { storeTelemetry } = require("../config/telemetryBuckets");
const { processTelemetry } = require("../config/telemetryWorkerPool");
const express = require("express");
const { publisher } = require("../config/redisClient");

const router = express.Router();

router.post("/ingest", async (req, res) => {
  let result;

  try {
    const workerStart = performance.now();

result = await processTelemetry(req.body);

console.log(
  `[TIMING] Worker round-trip: ${(performance.now() - workerStart).toFixed(2)} ms`
);
console.log(
  `[TIMING] Worker validation: ${result.workerDurationMs?.toFixed(2) ?? "unavailable"} ms`
);

  } catch (error) {
    if (error.code === "WORKER_QUEUE_FULL") {
      return res.status(503).json({
        success: false,
        error: "Telemetry processing queue is full",
      });
    }

    console.error("Telemetry worker pool error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Telemetry processing failed",
    });
  }

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: result.error,
    });
  }

  try {
    const mongoStart = performance.now();
const bucket = await storeTelemetry(result.telemetry);
console.log(
  `[TIMING] MongoDB storage: ${(performance.now() - mongoStart).toFixed(2)} ms`
);

    const redisStart = performance.now();

await publisher.publish(
  "fleetdash:telemetry",
  JSON.stringify(result.telemetry)
);

console.log(
  `[TIMING] Redis publish: ${(performance.now() - redisStart).toFixed(2)} ms`
);

    return res.status(200).json({
      success: true,
      message: "Telemetry processed and stored successfully",
      telemetry: result.telemetry,
      bucket,
    });
  } catch (error) {
    console.error("Telemetry storage error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Failed to store telemetry",
    });
  }
});

module.exports = router;
