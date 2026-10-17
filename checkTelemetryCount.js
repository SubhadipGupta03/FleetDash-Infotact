
require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const collection = client
      .db("fleetdash")
      .collection("telemetryBuckets");

    const result = await collection.aggregate([
       { $match: { vehicleId: "VH-K6-CLEAN-001" } },
      {
        $group: {
          _id: "$vehicleId",
          totalReadings: { $sum: "$count" },
          buckets: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    console.table(result);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
