require("dotenv").config();

const { MongoClient } = require("mongodb");

const RUNS = 100;
const EXPECTED_INDEX = "vehicle_bucket_unique";

function findIndexName(plan) {
  if (!plan || typeof plan !== "object") return null;
  if (plan.indexName) return plan.indexName;

  for (const value of Object.values(plan)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findIndexName(item);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findIndexName(value);
      if (found) return found;
    }
  }

  return null;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const collection = client.db("fleetdash").collection("telemetryBuckets");

    const sample = await collection.findOne(
      {},
      { projection: { _id: 0, vehicleId: 1, bucketStart: 1 } }
    );

    if (!sample) {
      throw new Error("No telemetry bucket found. Run ingestion first.");
    }

    const filter = {
      vehicleId: sample.vehicleId,
      bucketStart: sample.bucketStart,
    };

    for (let i = 0; i < 10; i++) {
      await collection.find(filter).limit(1).explain("executionStats");
    }

    const samples = [];

    for (let i = 0; i < RUNS; i++) {
      const result = await collection
        .find(filter)
        .limit(1)
        .explain("executionStats");

      const stats = result.executionStats;
      const indexName = findIndexName(result.queryPlanner.winningPlan);

      samples.push({
        executionMs: stats.executionTimeMillis,
        indexName,
        keysExamined: stats.totalKeysExamined,
        docsExamined: stats.totalDocsExamined,
        returned: stats.nReturned,
      });
    }

    const times = samples.map(s => s.executionMs).sort((a, b) => a - b);
    const average = times.reduce((sum, t) => sum + t, 0) / times.length;
    const percentile = p => times[Math.ceil(p * times.length) - 1];

    const report = {
      runs: RUNS,
      expectedIndex: EXPECTED_INDEX,
      samplesUsingExpectedIndex: samples.filter(
        s => s.indexName === EXPECTED_INDEX
      ).length,
      samplesUnder5ms: samples.filter(s => s.executionMs < 5).length,
      maxReportedExecutionMs: times[times.length - 1],
      averageReportedExecutionMs: Number(average.toFixed(2)),
      p95ReportedExecutionMs: percentile(0.95),
      maxKeysExamined: Math.max(...samples.map(s => s.keysExamined)),
      maxDocsExamined: Math.max(...samples.map(s => s.docsExamined)),
      allReturnedOneDocument: samples.every(s => s.returned === 1),
      timingNote:
        "MongoDB executionTimeMillis has whole-millisecond precision; this measures server-reported execution, not client network latency.",
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error("Query performance check failed:", error.message);
  process.exitCode = 1;
});
