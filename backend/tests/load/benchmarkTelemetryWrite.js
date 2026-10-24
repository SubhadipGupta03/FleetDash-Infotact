require("dotenv").config();

const { connectDatabase, getDatabase, closeDatabase } = require("../../config/database");
const { storeTelemetry } = require("../../config/telemetryBuckets");
const { performance } = require("node:perf_hooks");

const RUNS = 30;
const VEHICLE_ID = `VH-WRITE-BENCH-${Date.now()}`;

async function main() {
  const timings = [];

  try {
    await connectDatabase();

    const db = getDatabase();
    const collection = db.collection("telemetryBuckets");

    // Warm up the database write path.
    for (let i = 0; i < 3; i++) {
      await storeTelemetry({
        vehicleId: VEHICLE_ID,
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      });
    }

    for (let i = 0; i < RUNS; i++) {
      const telemetry = {
        vehicleId: VEHICLE_ID,
        latitude: 28.6139 + i * 0.00001,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      };

      const start = performance.now();
      await storeTelemetry(telemetry);
      timings.push(performance.now() - start);
    }

    timings.sort((a, b) => a - b);

    const average =
      timings.reduce((sum, value) => sum + value, 0) / timings.length;

    const percentile = (p) =>
      timings[Math.ceil(p * timings.length) - 1];

    const verification = await collection.aggregate([
      { $match: { vehicleId: VEHICLE_ID } },
      {
        $group: {
          _id: null,
          readingCount: { $sum: "$count" },
          bucketCount: { $sum: 1 },
        },
      },
    ]).toArray();

    console.log({
      runs: RUNS,
      averageWriteRoundTripMs: Number(average.toFixed(3)),
      medianWriteRoundTripMs: Number(percentile(0.5).toFixed(3)),
      p95WriteRoundTripMs: Number(percentile(0.95).toFixed(3)),
      minWriteRoundTripMs: Number(timings[0].toFixed(3)),
      maxWriteRoundTripMs: Number(timings[timings.length - 1].toFixed(3)),
      expectedReadings: RUNS + 3,
      databaseVerification: verification[0] || null,
      note: "Includes client-to-Atlas round-trip time for storeTelemetry().",
    });
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error("Write benchmark failed:", error.message);
  process.exitCode = 1;
});