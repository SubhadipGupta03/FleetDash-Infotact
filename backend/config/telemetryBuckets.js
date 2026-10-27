const { performance } = require("node:perf_hooks");
const { getDatabase, getClient } = require("./database");

const timingEnabled = process.env.TELEMETRY_TIMING === "true";

function logTiming(label, start) {
  if (timingEnabled) {
    console.log(
      `[TIMING] ${label}: ${(performance.now() - start).toFixed(2)} ms`
    );
  }
}

async function ensureTelemetryIndexes() {
  const db = getDatabase();

  await db.collection("telemetryBuckets").createIndex(
    { vehicleId: 1, bucketStart: 1 },
    {
      unique: true,
      name: "vehicle_bucket_unique",
    }
  );

  console.log("Telemetry indexes created successfully");
}

function validateTelemetry(telemetry) {
  if (!telemetry || typeof telemetry !== "object" || Array.isArray(telemetry)) {
    throw new Error("Telemetry must be an object");
  }

  if (
    typeof telemetry.eventId !== "string" ||
    telemetry.eventId.trim() === ""
  ) {
    throw new Error("eventId is required for telemetry storage");
  }

  if (
    typeof telemetry.vehicleId !== "string" ||
    telemetry.vehicleId.trim() === ""
  ) {
    throw new Error("vehicleId is required for telemetry storage");
  }

  if (
    !Number.isFinite(telemetry.latitude) ||
    telemetry.latitude < -90 ||
    telemetry.latitude > 90
  ) {
    throw new Error("A valid latitude is required for telemetry storage");
  }

  if (
    !Number.isFinite(telemetry.longitude) ||
    telemetry.longitude < -180 ||
    telemetry.longitude > 180
  ) {
    throw new Error("A valid longitude is required for telemetry storage");
  }

  const timestamp = new Date(telemetry.timestamp);

  if (
    telemetry.timestamp === undefined ||
    telemetry.timestamp === null ||
    telemetry.timestamp === "" ||
    Number.isNaN(timestamp.getTime())
  ) {
    throw new Error("A valid timestamp is required for telemetry storage");
  }

  return {
    eventId: telemetry.eventId.trim(),
    vehicleId: telemetry.vehicleId.trim(),
    latitude: telemetry.latitude,
    longitude: telemetry.longitude,
    timestamp,
  };
}

function isDuplicateEventError(error, eventId) {
  if (error?.code !== 11000) {
    return false;
  }

  // Only treat a collision on the event record's _id as a duplicate
  // event. A bucket-index collision is a different storage failure.
  return (
    error.keyPattern?._id === 1 ||
    error.keyValue?._id === eventId
  );
}

async function storeTelemetry(input) {
  const telemetry = validateTelemetry(input);

  const {
    eventId,
    vehicleId,
    latitude,
    longitude,
    timestamp,
  } = telemetry;

  const db = getDatabase();
  const client = getClient();

  const buckets = db.collection("telemetryBuckets");
  const events = db.collection("telemetryEvents");

  const bucketStart = new Date(timestamp);
  bucketStart.setUTCMinutes(0, 0, 0);

  const bucketEnd = new Date(bucketStart);
  bucketEnd.setUTCHours(bucketEnd.getUTCHours() + 1);

  const reading = {
    eventId,
    timestamp,
    latitude,
    longitude,
  };

  const session = client.startSession();
  let duplicate = false;

  try {
    const transactionStart = performance.now();
let transactionCallbackAttempts = 0;

    await session.withTransaction(async () => {
     transactionCallbackAttempts += 1;

if (timingEnabled) {
  console.log(
    `[TIMING] MongoDB transaction callback attempt: ${transactionCallbackAttempts}`
  );
}
      let operationStart = performance.now();

      // The unique _id ensures an eventId can only be recorded once.
      await events.insertOne(
        {
          _id: eventId,
          vehicleId,
          timestamp,
        },
        { session }
      );

      logTiming("MongoDB event insert", operationStart);

      operationStart = performance.now();

      await buckets.updateOne(
        {
          vehicleId,
          bucketStart,
        },
        {
          $setOnInsert: {
            vehicleId,
            bucketStart,
            bucketEnd,
          },
          $push: {
            readings: reading,
          },
          $inc: {
            count: 1,
          },
        },
        {
          upsert: true,
          session,
        }
      );

      logTiming("MongoDB bucket update", operationStart);
    });

    logTiming("MongoDB transaction total", transactionStart);

    if (timingEnabled) {
      console.log("[TIMING] MongoDB transaction committed");
    }
  } catch (error) {
    if (isDuplicateEventError(error, eventId)) {
      duplicate = true;
    } else {
      throw error;
    }
  } finally {
    await session.endSession();
  }

  return {
    vehicleId,
    bucketStart: bucketStart.toISOString(),
    timestamp: timestamp.toISOString(),
    eventId,
    duplicate,
  };
}

module.exports = {
  storeTelemetry,
  ensureTelemetryIndexes,
};