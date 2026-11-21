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
  const vehicleId = `VH-BUCKET-BOUNDARY-${runId}`;
    let db;

  try {
    db = await connectDatabase();
    const collection = db.collection("telemetryBuckets");

    const readings = [
      {
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: "2026-10-24T10:15:00.000Z",
      },
      {
        latitude: 28.614,
        longitude: 77.2091,
        timestamp: "2026-10-24T10:59:00.000Z",
      },
      {
        latitude: 28.615,
        longitude: 77.21,
        timestamp: "2026-10-24T11:00:00.000Z",
      },
    ];

    for (const [index, reading] of readings.entries()) {
      const result = await storeTelemetry({
        ...reading,
        eventId: `${vehicleId}-EVENT-${index + 1}`,
        vehicleId,
      });

      if (result.duplicate) {
        throw new Error(`Unexpected duplicate at reading ${index + 1}`);
      }
    }

    const buckets = await collection
      .find({ vehicleId })
      .sort({ bucketStart: 1 })
      .toArray();

    console.log("Test vehicle:", vehicleId);
    console.log("Buckets found:", buckets.length);

    for (const bucket of buckets) {
      console.log({
        bucketStart: bucket.bucketStart.toISOString(),
        bucketEnd: bucket.bucketEnd.toISOString(),
        count: bucket.count,
        readingsLength: bucket.readings.length,
      });
    }

    const hourlyTotals = new Map();

    for (const bucket of buckets) {
      const hour = bucket.bucketStart.toISOString();
      const expectedEnd = new Date(
        new Date(hour).getTime() + 60 * 60 * 1000
      ).toISOString();

      const existing = hourlyTotals.get(hour) || {
        count: 0,
        readingsLength: 0,
        validEnd: true,
      };

      existing.count += bucket.count;
      existing.readingsLength += bucket.readings.length;
      existing.validEnd =
        existing.validEnd &&
        bucket.bucketEnd.toISOString() === expectedEnd;

      hourlyTotals.set(hour, existing);
    }

    const firstHour = hourlyTotals.get("2026-10-24T10:00:00.000Z");
    const secondHour = hourlyTotals.get("2026-10-24T11:00:00.000Z");

    const passed =
      hourlyTotals.size === 2 &&
      firstHour?.count === 2 &&
      firstHour?.readingsLength === 2 &&
      firstHour?.validEnd === true &&
      secondHour?.count === 1 &&
      secondHour?.readingsLength === 1 &&
      secondHour?.validEnd === true;

    if (!passed) {
      throw new Error("FAIL: UTC hourly bucket boundary verification");
    }

    console.log("PASS: UTC hourly bucket boundaries verified");
    } finally {
    if (db) {
      await Promise.all([
        db.collection("telemetryBuckets").deleteMany({ vehicleId }),
        db.collection("telemetryEvents").deleteMany({ vehicleId }),
        db.collection("telemetryOutbox").deleteMany({
          "telemetry.vehicleId": vehicleId,
        }),
      ]);

      console.log("PASS: Test records cleaned up");
    }

    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
