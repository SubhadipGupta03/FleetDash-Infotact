
const { getDatabase } = require("./database");

async function ensureTelemetryIndexes() {
  const db = getDatabase();
  const collection = db.collection("telemetryBuckets");

  await collection.createIndex(
    { vehicleId: 1, bucketStart: 1 },
    { unique: true, name: "vehicle_bucket_unique" }
  );

  console.log("Telemetry indexes created successfully");
}


async function storeTelemetry(telemetry) {
  const db = getDatabase();
  const collection = db.collection("telemetryBuckets");

  const timestamp = new Date(telemetry.timestamp);

  // Round down to the start of the UTC hour.
  const bucketStart = new Date(timestamp);
  bucketStart.setUTCMinutes(0, 0, 0);

  const bucketEnd = new Date(bucketStart);
  bucketEnd.setUTCHours(bucketEnd.getUTCHours() + 1);

  const reading = {
    timestamp,
    latitude: telemetry.latitude,
    longitude: telemetry.longitude,
  };

  await collection.updateOne(
    {
      vehicleId: telemetry.vehicleId,
      bucketStart,
    },
    {
      $setOnInsert: {
        vehicleId: telemetry.vehicleId,
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
    { upsert: true }
  );

  return {
    vehicleId: telemetry.vehicleId,
    bucketStart: bucketStart.toISOString(),
    timestamp: timestamp.toISOString(),
  };
}

module.exports = { storeTelemetry, ensureTelemetryIndexes };