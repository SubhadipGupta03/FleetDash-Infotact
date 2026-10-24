require("dotenv").config();

const {
  connectDatabase,
  closeDatabase,
} = require("../../config/database");

const {
  storeTelemetry,
} = require("../../config/telemetryBuckets");

async function main() {
  const vehicleId = `VH-BUCKET-BOUNDARY-${Date.now()}`;

  try {
    const db = await connectDatabase();
    const collection = db.collection("telemetryBuckets");

    const readings = [
      {
        vehicleId,
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: "2026-10-24T10:15:00.000Z",
      },
      {
        vehicleId,
        latitude: 28.614,
        longitude: 77.2091,
        timestamp: "2026-10-24T10:59:00.000Z",
      },
      {
        vehicleId,
        latitude: 28.615,
        longitude: 77.21,
        timestamp: "2026-10-24T11:00:00.000Z",
      },
    ];

    for (const reading of readings) {
      await storeTelemetry(reading);
    }

    const buckets = await collection
      .find({ vehicleId })
      .sort({ bucketStart: 1 })
      .toArray();

    console.log("Test vehicle:", vehicleId);
    console.log("Buckets found:", buckets.length);

    for (const bucket of buckets) {
      console.log({
        bucketStart: bucket.bucketStart.toISOString(),
        bucketEnd: bucket.bucketEnd.toISOString(),
        count: bucket.count,
        readingsLength: bucket.readings.length,
      });
    }

    const passed =
      buckets.length === 2 &&
      buckets[0].bucketStart.toISOString() ===
        "2026-10-24T10:00:00.000Z" &&
      buckets[0].bucketEnd.toISOString() ===
        "2026-10-24T11:00:00.000Z" &&
      buckets[0].count === 2 &&
      buckets[0].readings.length === 2 &&
      buckets[1].bucketStart.toISOString() ===
        "2026-10-24T11:00:00.000Z" &&
      buckets[1].bucketEnd.toISOString() ===
        "2026-10-24T12:00:00.000Z" &&
      buckets[1].count === 1 &&
      buckets[1].readings.length === 1;

    if (!passed) {
      throw new Error("FAIL: UTC hourly bucket boundary verification");
    }

    console.log("PASS: UTC hourly bucket boundaries verified");
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});