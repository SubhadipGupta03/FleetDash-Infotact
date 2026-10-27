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
  const vehicleId = `VH-REPEATED-INGESTION-${runId}`;

  try {
    const db = await connectDatabase();
    const collection = db.collection("telemetryBuckets");

    const readings = [
      {
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: "2026-10-24T14:10:00.000Z",
      },
      {
        latitude: 28.614,
        longitude: 77.2091,
        timestamp: "2026-10-24T14:20:00.000Z",
      },
      {
        latitude: 28.615,
        longitude: 77.21,
        timestamp: "2026-10-24T14:30:00.000Z",
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

    const buckets = await collection.find({ vehicleId }).toArray();
    const bucket = buckets[0];

    console.log("Test vehicle:", vehicleId);
    console.log("Buckets found:", buckets.length);

    if (bucket) {
      console.log({
        bucketStart: bucket.bucketStart.toISOString(),
        bucketEnd: bucket.bucketEnd.toISOString(),
        count: bucket.count,
        readingsLength: bucket.readings.length,
        timestamps: bucket.readings.map(
          (reading) => reading.timestamp.toISOString()
        ),
      });
    }

    const passed =
      buckets.length === 1 &&
      bucket.count === 3 &&
      bucket.readings.length === 3 &&
      bucket.bucketStart.toISOString() ===
        "2026-10-24T14:00:00.000Z" &&
      bucket.bucketEnd.toISOString() ===
        "2026-10-24T15:00:00.000Z";

    if (!passed) {
      throw new Error(
        "FAIL: Repeated readings were not stored in one bucket correctly"
      );
    }

    console.log(
      "PASS: Repeated ingestion appends readings and increments count"
    );
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
