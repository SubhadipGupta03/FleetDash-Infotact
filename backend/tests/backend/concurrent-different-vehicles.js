
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../../.env"),
});

const {
  connectDatabase,
  closeDatabase,
} = require("../../config/database");

const { storeTelemetry } = require("../../config/telemetryBuckets");

async function main() {
  const total = 10;
  const runId = Date.now();

  const eventIds = Array.from(
    { length: total },
    (_, i) => `DIFFERENT-VEHICLE-${runId}-${i}`
  );

  let db;

  try {
    db = await connectDatabase();

    const events = db.collection("telemetryEvents");
    const outbox = db.collection("telemetryOutbox");
    const buckets = db.collection("telemetryBuckets");

    const start = performance.now();

    const results = await Promise.allSettled(
      Array.from({ length: total }, (_, i) => {
        const timestamp = new Date(Date.now() + i * 1000);

        return storeTelemetry({
          eventId: eventIds[i],
          vehicleId: eventIds[i],
          latitude: 28.6139 + i * 0.001,
          longitude: 77.209 + i * 0.001,
          timestamp,
        });
      })
    );

    const durationMs = performance.now() - start;

    const eventCount = await events.countDocuments({
      _id: { $in: eventIds },
    });

    const outboxCount = await outbox.countDocuments({
      _id: { $in: eventIds },
    });

    const bucketCount = await buckets.countDocuments({
      vehicleId: { $in: eventIds },
    });

    const successful = results.filter(
      (result) => result.status === "fulfilled" && !result.value.duplicate
    ).length;

    const failed = results.filter(
      (result) => result.status === "rejected"
    );

    console.log("\nDIFFERENT VEHICLES CONCURRENT TEST");
    console.log({
      submitted: total,
      successful,
      failed: failed.length,
      eventRecords: eventCount,
      outboxRecords: outboxCount,
      bucketDocuments: bucketCount,
      durationMs: Number(durationMs.toFixed(2)),
    });

    if (failed.length > 0) {
      console.log(
        "Errors:",
        failed.map((result) => result.reason?.message)
      );
    }

    const passed =
      successful === total &&
      failed.length === 0 &&
      eventCount === total &&
      outboxCount === total &&
      bucketCount === total;

    console.log(
      passed
        ? "PASS: All events stored across separate vehicle buckets"
        : "FAIL: One or more verification checks failed"
    );
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
          vehicleId: { $in: eventIds },
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
