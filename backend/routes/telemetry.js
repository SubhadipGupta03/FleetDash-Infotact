const { performance } = require("node:perf_hooks");
const express = require("express");
const { storeTelemetry } = require("../config/telemetryBuckets");
const { processTelemetry } = require("../config/telemetryWorkerPool");
const { publisher } = require("../config/redisClient");

const router = express.Router();
const timingEnabled = process.env.TELEMETRY_TIMING === "true";
const TELEMETRY_CHANNEL = "fleetdash:telemetry";

router.post("/ingest", async (req, res) => {
  // Validate the idempotency key before consuming worker capacity.
  const bodyEventId =
    typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";

  const headerEventId =
    typeof req.get("Idempotency-Key") === "string"
      ? req.get("Idempotency-Key").trim()
      : "";

  const eventId = bodyEventId || headerEventId;

  if (!eventId) {
    return res.status(400).json({
      success: false,
      error: "eventId or Idempotency-Key is required",
    });
  }

  let result;

  try {
    const workerStart = performance.now();
    result = await processTelemetry(req.body);

    if (timingEnabled) {
      console.log(
        `[TIMING] Worker round-trip: ${(
          performance.now() - workerStart
        ).toFixed(2)} ms`
      );

      console.log(
        `[TIMING] Worker validation: ${
          result.workerDurationMs?.toFixed(2) ?? "unavailable"
        } ms`
      );
    }
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

  if (!result?.success) {
    return res.status(400).json({
      success: false,
      error: result?.error || "Invalid telemetry payload",
    });
  }

  const telemetry = {
    ...result.telemetry,
    eventId,
  };

  let bucket;

  // Persist the event before publishing it to Redis.
  try {
    const mongoStart = performance.now();
    bucket = await storeTelemetry(telemetry);

    if (timingEnabled) {
      console.log(
        `[TIMING] MongoDB storage: ${(
          performance.now() - mongoStart
        ).toFixed(2)} ms`
      );
    }
  } catch (error) {
    console.error("Telemetry storage error:", {
      message: error.message,
      code: error.code,
      codeName: error.codeName,
      errorLabels: error.errorLabels,
    });

    return res.status(500).json({
      success: false,
      error: "Failed to store telemetry",
    });
  }

  // Do not broadcast an event already recorded as a duplicate.
  // Reliable recovery after a failed publish requires a persistent
  // delivery/outbox mechanism, which must be implemented with storage.
  if (bucket.duplicate) {
    return res.status(200).json({
      success: true,
      message: "Duplicate event recognized; no new broadcast sent",
      duplicate: true,
      telemetry,
      bucket,
    });
  }

  try {
    const redisStart = performance.now();

    await publisher.publish(
      TELEMETRY_CHANNEL,
      JSON.stringify(telemetry)
    );

    if (timingEnabled) {
      console.log(
        `[TIMING] Redis publish: ${(
          performance.now() - redisStart
        ).toFixed(2)} ms`
      );
    }
  } catch (error) {
    console.error("Redis telemetry publish error:", {
      message: error.message,
      code: error.code,
    });

    return res.status(503).json({
      success: false,
      stored: true,
      published: false,
      eventId,
      error: "Telemetry was stored, but Redis publishing failed",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Telemetry processed and stored successfully",
    duplicate: false,
    telemetry,
    bucket,
  });
});

module.exports = router;