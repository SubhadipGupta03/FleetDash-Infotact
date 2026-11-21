require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../../.env"),
});

const {
  connectDatabase,
  closeDatabase,
} = require("../../config/database");

const {
  storeTelemetry,
} = require("../../config/telemetryBuckets");

async function main() {
  const runId = Date.now();
  const vehicleId = `VH-CONCURRENT-DUP-${runId}`;
  const eventId = `${vehicleId}-EVENT-1`;

  const telemetry = {
    eventId,
    vehicleId,
    latitude: 28.6139,
    longitude: 77.209,
    timestamp: "2026-10-24T14:10:00.000Z",
  };

  let db;

  try {
    db = await connectDatabase();
    const buckets = db.collection("telemetryBuckets");
    const events = db.collection("telemetryEvents");
    const outbox = db.collection("telemetryOutbox");

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => storeTelemetry(telemetry))
    );

    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length > 0) {
      console.error(
        "Rejected concurrent calls:",
        rejected.map((result) => result.reason?.message || String(result.reason))
      );
      throw new Error("FAIL: One or more concurrent submissions rejected");
    }

    const outcomes = results.map((result) => result.value);
    const duplicateCount = outcomes.filter((result) => result.duplicate).length;
    const storedResults = outcomes.filter((result) => !result.duplicate);

    const storedBuckets = await buckets.find({ vehicleId }).toArray();
    const eventCount = await events.countDocuments({ _id: eventId });
    const outboxCount = await outbox.countDocuments({ _id: eventId });
    console.log({
      submissions: outcomes.length,
      nonDuplicateResults: storedResults.length,
      duplicateResults: duplicateCount,
      bucketsFound: storedBuckets.length,
      bucketCount: storedBuckets[0]?.count ?? null,
      readingsLength: storedBuckets[0]?.readings?.length ?? null,
      eventRecords: eventCount,
      outboxRecords: outboxCount,
    });

    const passed =
      storedResults.length === 1 &&
      duplicateCount === 4 &&
      storedBuckets.length === 1 &&
      storedBuckets[0].count === 1 &&
      storedBuckets[0].readings.length === 1 &&
      eventCount === 1 &&
      outboxCount === 1;

    if (!passed) {
      throw new Error(
        "FAIL: Concurrent duplicate submissions produced inconsistent storage"
      );
    }

    console.log(
      "PASS: Concurrent duplicate submissions produced exactly one stored reading"
    );
  } finally {
    if (db) {
      await Promise.all([
        db.collection("telemetryEvents").deleteMany({
          _id: eventId,
        }),
        db.collection("telemetryOutbox").deleteMany({
          _id: eventId,
        }),
        db.collection("telemetryBuckets").deleteMany({
          vehicleId,
        }),
      ]);

      console.log("Test data cleanup completed.");
    }

    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
