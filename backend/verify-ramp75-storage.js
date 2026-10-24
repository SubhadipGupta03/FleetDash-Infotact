require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing");
  }

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const collection = client
      .db("fleetdash")
      .collection("telemetryBuckets");

    const vehicleId = "VH-K6-RAMP75-RETRY-20261023";

    const buckets = await collection
      .find({ vehicleId })
      .project({ _id: 0, vehicleId: 1, count: 1, readings: 1 })
      .toArray();

    const storedReadings = buckets.reduce(
      (total, bucket) => total + (bucket.readings?.length ?? 0),
      0
    );

    const storedCount = buckets.reduce(
      (total, bucket) => total + (bucket.count ?? 0),
      0
    );

    console.log("Vehicle ID:", vehicleId);
    console.log("Bucket documents:", buckets.length);
    console.log("Stored readings array length:", storedReadings);
    console.log("Sum of bucket count fields:", storedCount);
    console.log("Expected successful requests: 751");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Verification failed:", error.message);
  process.exitCode = 1;
});
