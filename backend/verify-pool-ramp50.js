require("dotenv").config();
const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    const db = client.db("fleetdash");
    const vehicleId = "VH-K6-POOL-RAMP50-RETRY-20261023";

    const buckets = await db.collection("telemetryBuckets")
      .find({ vehicleId })
      .toArray();

    const bucketCount = buckets.reduce((sum, bucket) => sum + (bucket.count || 0), 0);
    const readingCount = buckets.reduce((sum, bucket) => sum + (bucket.readings?.length || 0), 0);

    console.log("Expected completed HTTP requests: 1001");
    console.log("Buckets found:", buckets.length);
    console.log("Total bucket count:", bucketCount);
    console.log("Actual readings stored:", readingCount);
    console.log("Counts match:", bucketCount === readingCount);
    console.log("All completed requests stored:", readingCount === 1001);
  } finally {
    await client.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});




