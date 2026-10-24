
require("dotenv").config();

const { MongoClient } = require("mongodb");
const { performance } = require("node:perf_hooks");

const RUNS = 100;

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const collection = client
      .db("fleetdash")
      .collection("telemetryBuckets");

    const sample = await collection.findOne(
      {},
      { projection: { _id: 0, vehicleId: 1, bucketStart: 1 } }
    );

    if (!sample) {
      throw new Error("No telemetry bucket found. Ingest a test reading first.");
    }

    const filter = {
      vehicleId: sample.vehicleId,
      bucketStart: sample.bucketStart,
    };

    // Warm up the connection and query path.
    for (let i = 0; i < 10; i++) {
      await collection.findOne(filter);
    }

    const timings = [];

    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const result = await collection.findOne(filter);
      const elapsedMs = performance.now() - start;

      if (!result) {
        throw new Error("Expected bucket was not found during benchmark");
      }

      timings.push(elapsedMs);
    }

    timings.sort((a, b) => a - b);

    const average =
      timings.reduce((sum, value) => sum + value, 0) / timings.length;

    const percentile = (p) =>
      timings[Math.ceil(p * timings.length) - 1];

    console.log({
      runs: RUNS,
      averageRoundTripMs: Number(average.toFixed(3)),
      medianRoundTripMs: Number(percentile(0.50).toFixed(3)),
      p95RoundTripMs: Number(percentile(0.95).toFixed(3)),
      minRoundTripMs: Number(timings[0].toFixed(3)),
      maxRoundTripMs: Number(timings[timings.length - 1].toFixed(3)),
      note: "Includes client-to-Atlas network round-trip time, not just MongoDB server execution time.",
    });
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Query benchmark failed:", error.message);
  process.exitCode = 1;
});
