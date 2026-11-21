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
  const vehicleId = `VH-CONCURRENT-DISTINCT-${runId}`;
  const total = 10;

  const eventIds = Array.from(
    { length: total },
    (_, index) => `${vehicleId}-EVENT-${index + 1}`
  );

  let db;

  try {
    db = await connectDatabase();
    const buckets = db.collection("telemetryBuckets");
    const events = db.collection("telemetryEvents");
    const outbox = db.collection("telemetryOutbox");

    const results = await Promise.allSettled(
      Array.from({ length: total }, (_, index) =>
        storeTelemetry({
          eventId: eventIds[index],
          vehicleId,
          latitude: 28.6139 + index * 0.0001,
          longitude: 77.209 + index * 0.0001,
          timestamp: `2026-10-24T14:${String(index).padStart(2, "0")}:00.000Z`,
        })
      )
    );

    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length > 0) {
      console.error(
        "Rejected submissions:",
        rejected.map((result) => result.reason?.message || String(result.reason))
      );
      throw new Error("FAIL: One or more distinct concurrent events failed");
    }

    const values = results.map((result) => result.value);
    const duplicateCount = values.filter((value) => value.duplicate).length;
    const storedBuckets = await buckets.find({ vehicleId }).toArray();

const eventCount = await events.countDocuments({ vehicleId });

const outboxCount = await outbox.countDocuments({
  "telemetry.vehicleId": vehicleId,
});

const totalBucketCount = storedBuckets.reduce(
  (sum, bucket) => sum + (bucket.count ?? 0),
  0
);

const allReadings = storedBuckets.flatMap(
  (bucket) => bucket.readings ?? []
);

const uniqueEventIds = new Set(
  allReadings.map((reading) => reading.eventId)
);

console.log({
  submitted: total,
  successfulNonDuplicateResults: values.filter(
    (value) => !value.duplicate
  ).length,
  unexpectedDuplicateResults: duplicateCount,
  bucketsFound: storedBuckets.length,
  totalBucketCount,
  totalReadings: allReadings.length,
  uniqueReadingEventIds: uniqueEventIds.size,
  eventRecords: eventCount,
  outboxRecords: outboxCount,
});

const passed =
  values.length === total &&
  duplicateCount === 0 &&
  storedBuckets.length >= 1 &&
  storedBuckets.every(
    (bucket) =>
      Number.isInteger(bucket.partition) &&
      bucket.partition >= 0 &&
      bucket.partition < 16 &&
      bucket.count === bucket.readings.length
  ) &&
  totalBucketCount === total &&
  allReadings.length === total &&
  uniqueEventIds.size === total &&
  eventCount === total &&
  outboxCount === total;

    if (!passed) {
      throw new Error("FAIL: Concurrent distinct events were lost or inconsistently stored");
    }

    console.log("PASS: All distinct concurrent events were stored exactly once");
  } finally {
    if (db) {
      await Promise.all([
        db.collection("telemetryEvents").deleteMany({
          _id: { $in: eventIds },
        }),
        db.collection("telemetryOutbox").deleteMany({
          _id: { $in: eventIds },
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
