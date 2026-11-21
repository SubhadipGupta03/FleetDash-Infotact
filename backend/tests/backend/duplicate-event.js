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
  const vehicleId = `VH-DUPLICATE-TEST-${runId}`;
  const eventId = `${vehicleId}-EVENT-1`;

  const original = {
    eventId,
    vehicleId,
    latitude: 28.6139,
    longitude: 77.209,
    timestamp: "2026-10-24T14:10:00.000Z",
  };

  try {
    const db = await connectDatabase();
    const buckets = db.collection("telemetryBuckets");
    const events = db.collection("telemetryEvents");

    const first = await storeTelemetry(original);
    if (first.duplicate) {
      throw new Error("FAIL: First submission was marked as a duplicate");
    }

    const afterFirst = await buckets.find({ vehicleId }).toArray();
    if (
      afterFirst.length !== 1 ||
      afterFirst[0].count !== 1 ||
      afterFirst[0].readings.length !== 1
    ) {
      throw new Error("FAIL: First submission was not stored exactly once");
    }

    const duplicate = await storeTelemetry(original);
    if (!duplicate.duplicate) {
      throw new Error("FAIL: Repeated eventId was not marked as duplicate");
    }

    const afterDuplicate = await buckets.find({ vehicleId }).toArray();
    if (
      afterDuplicate.length !== 1 ||
      afterDuplicate[0].count !== 1 ||
      afterDuplicate[0].readings.length !== 1
    ) {
      throw new Error("FAIL: Duplicate changed the bucket or reading count");
    }

    const secondEvent = await storeTelemetry({
      ...original,
      eventId: `${vehicleId}-EVENT-2`,
      timestamp: "2026-10-24T14:20:00.000Z",
      latitude: 28.614,
      longitude: 77.2091,
    });

    if (secondEvent.duplicate) {
      throw new Error("FAIL: A different eventId was marked as duplicate");
    }

    const finalBuckets = await buckets.find({ vehicleId }).toArray();
    const eventCount = await events.countDocuments({
      vehicleId,
    });

    const totalBucketCount = finalBuckets.reduce(
      (total, bucket) => total + bucket.count,
      0
    );

    const totalReadings = finalBuckets.reduce(
      (total, bucket) => total + bucket.readings.length,
      0
    );

    if (
      totalBucketCount !== 2 ||
      totalReadings !== 2 ||
      eventCount !== 2
    ) {
      throw new Error("FAIL: Final bucket or event records are inconsistent");
    }

    console.log({
      vehicleId,
      firstSubmissionDuplicate: first.duplicate,
      repeatedSubmissionDuplicate: duplicate.duplicate,
      differentEventDuplicate: secondEvent.duplicate,
      bucketCount: finalBuckets.length,
      totalBucketCount,
      totalReadings,
      eventRecords: eventCount,
    });

    console.log("PASS: Duplicate event does not create an extra reading");
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
