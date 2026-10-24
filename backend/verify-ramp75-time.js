require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const collection = client.db("fleetdash").collection("telemetryBuckets");
    const vehicleId = "VH-K6-RAMP75-RETRY-20261023";

    const buckets = await collection
      .find({ vehicleId })
      .project({ _id: 0, bucketStart: 1, count: 1, readings: 1 })
      .toArray();

    for (const bucket of buckets) {
      const times = (bucket.readings || [])
        .map((r) => new Date(r.timestamp).getTime())
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      console.log({
        bucketStart: bucket.bucketStart,
        count: bucket.count,
        readings: times.length,
        firstReading: times.length ? new Date(times[0]).toISOString() : null,
        lastReading: times.length ? new Date(times[times.length - 1]).toISOString() : null,
      });
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Verification failed:", error.message);
  process.exitCode = 1;
});
