
require('dotenv').config();

const { MongoClient } = require('mongodb');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const db = client.db('fleetdash');
    const collection = db.collection('telemetryBuckets');

    const sample = await collection.findOne(
      {},
      { projection: { vehicleId: 1, bucketStart: 1 } }
    );

    if (!sample) {
      console.log('No telemetry bucket found. Run the ingestion test first.');
      return;
    }

    const result = await collection
      .find({
        vehicleId: sample.vehicleId,
        bucketStart: sample.bucketStart,
      })
      .explain('executionStats');

    console.log(JSON.stringify({
      indexName: result.queryPlanner?.winningPlan,
      executionStats: result.executionStats,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Query performance check failed:', error.message);
  process.exitCode = 1;
});
