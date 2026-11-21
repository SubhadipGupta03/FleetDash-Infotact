const {
  processGeofenceAlerts,
} = require("../services/geofenceAlertService");
const { performance } = require("node:perf_hooks");
const express = require("express");
const { storeTelemetry } = require("../config/telemetryBuckets");
const { processTelemetry } = require("../config/telemetryWorkerPool");


const router = express.Router();
const { getDatabase } = require("../config/database");
const timingEnabled = process.env.TELEMETRY_TIMING === "true";

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

  // Duplicate events are not inserted into the outbox again.
// The original event remains eligible for background delivery.

  if (bucket.duplicate) {
    return res.status(200).json({
      success: true,
      message: "Duplicate event recognized; no new broadcast sent",
      duplicate: true,
      telemetry,
      bucket,
      geofenceAlerts: [],
    });
  }

  // Process geofence entry and exit transitions.
  let geofenceAlerts = [];
  const geofenceStart = performance.now();

  try {
    geofenceAlerts = await processGeofenceAlerts(telemetry);
  } catch (error) {
    console.error("Geofence alert processing error:", error.message);
  } finally {
    if (timingEnabled) {
      console.log(
        `[TIMING] Geofence processing: ${(
          performance.now() - geofenceStart
        ).toFixed(2)} ms`
      );
    }
  }
  return res.status(200).json({
    success: true,
    message: "Telemetry stored successfully; delivery queued through outbox",
    duplicate: false,
    telemetry,
    bucket,
    geofenceAlerts,
  });
});

// Retrieve historical fleet telemetry for dashboard initialization.
router.get("/history", async (req, res) => {
  try {
    const db = getDatabase();

    const buckets = db.collection("telemetryBuckets");
    const events = db.collection("telemetryEvents");
    const alerts = db.collection("geofenceAlerts");

    const [
      totalTelemetryEvents,
      vehicleSummaries,
      recentAlerts,
      recentBuckets,
    ] = await Promise.all([
      events.estimatedDocumentCount(),

      // Latest reading per vehicle, taken from each vehicle's newest bucket.
            buckets
        .aggregate([
  {
    $project: {
      vehicleId: 1,
      count: 1,
      latestReading: {
        $reduce: {
          input: "$readings",
          initialValue: null,
          in: {
            $cond: [
              {
                $or: [
                  { $eq: ["$$value", null] },
                  { $gt: ["$$this.timestamp", "$$value.timestamp"] },
                ],
              },
              "$$this",
              "$$value",
            ],
          },
        },
      },
    },
  },
  { $sort: { "latestReading.timestamp": -1 } },
  {
    $group: {
      _id: "$vehicleId",
      latestReading: { $first: "$latestReading" },
      telemetryCount: { $sum: "$count" },
    },
  },
  {
    $project: {
      _id: 0,
      vehicleId: "$_id",
      latitude: "$latestReading.latitude",
      longitude: "$latestReading.longitude",
      timestamp: "$latestReading.timestamp",
      telemetryCount: 1,
    },
  },
        ])
        .toArray(),

      alerts.find({}).sort({ timestamp: -1 }).limit(50).toArray(),

      buckets.aggregate([
  {
    $sort: {
      bucketStart: -1,
      vehicleId: 1,
      partition: 1,
    },
  },
  {
    $group: {
      _id: {
        vehicleId: "$vehicleId",
        bucketStart: "$bucketStart",
      },
      vehicleId: { $first: "$vehicleId" },
      bucketStart: { $first: "$bucketStart" },
      bucketEnd: { $first: "$bucketEnd" },
      readings: { $push: "$readings" },
      count: { $sum: "$count" },
    },
  },
  {
    $project: {
      _id: 0,
      vehicleId: 1,
      bucketStart: 1,
      bucketEnd: 1,
      count: 1,
      readings: {
        $sortArray: {
          input: {
            $reduce: {
              input: "$readings",
              initialValue: [],
              in: { $concatArrays: ["$$value", "$$this"] },
            },
          },
          sortBy: { timestamp: 1 },
        },
      },
    },
  },
  { $sort: { bucketStart: -1 } },
  { $limit: 100 },
]).toArray(),
    ]);

    return res.status(200).json({
      success: true,
      totalVehicles: vehicleSummaries.length,
      totalTelemetryEvents,
      vehicles: vehicleSummaries,
      geofenceAlerts: recentAlerts,
      recentBuckets,
    });
  } catch (error) {
    console.error("Historical telemetry retrieval error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to retrieve historical telemetry",
    });
  }
});

module.exports = router;
