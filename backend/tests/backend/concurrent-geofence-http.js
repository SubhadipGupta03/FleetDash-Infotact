require("dotenv").config();

const {
  connectDatabase,
  closeDatabase,
} = require("../../config/database");

const {
  connectRedis,
  publisher,
  subscriber,
} = require("../../config/redisClient");

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const vehicleId = `GEOFENCE-CONCURRENT-${Date.now()}`;
const geofenceId = "DURGAPUR-DEMO-ZONE";

const eventIds = [
  `${vehicleId}-INSIDE`,
  `${vehicleId}-EXIT-A`,
  `${vehicleId}-EXIT-B`,
];

const stateKey = [
  "fleetdash",
  "geofence-state",
  encodeURIComponent(vehicleId),
  encodeURIComponent(geofenceId),
].join(":");

const positionKey = `${stateKey}:position`;

function makeTelemetry(eventId, latitude, longitude, timestamp) {
  return {
    eventId,
    vehicleId,
    latitude,
    longitude,
    timestamp: new Date(timestamp).toISOString(),
  };
}

async function postTelemetry(payload) {
  const response = await fetch(`${BASE_URL}/api/telemetry/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": payload.eventId,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();

  return {
    status: response.status,
    body,
  };
}

async function runTest() {
  let db;
  let testPassed = false;

  const baseTime = Date.now();

  try {
    db = await connectDatabase();
    await connectRedis();

    console.log("\n--- CONCURRENT GEOFENCE HTTP TEST ---");
    console.log("Vehicle:", vehicleId);
    console.log("Backend:", BASE_URL);

    // Establish the initial INSIDE state through the real HTTP route.
    const inside = await postTelemetry(
      makeTelemetry(
        eventIds[0],
        28.6140,
        77.2100,
        baseTime
      )
    );

    const insidePassed =
      inside.status === 200 &&
      inside.body.success === true &&
      inside.body.duplicate === false;

    console.log(
      "1. Initial inside event:",
      insidePassed ? "PASS" : "FAIL"
    );

    if (!insidePassed) {
      throw new Error(
        `Inside event failed: HTTP ${inside.status} ${JSON.stringify(inside.body)}`
      );
    }

    // Submit two different outside events concurrently for the same vehicle.
    const outsideEvents = [
      makeTelemetry(eventIds[1], 28.6140, 77.2200, baseTime + 1000),
      makeTelemetry(eventIds[2], 28.6140, 77.2250, baseTime + 2000),
    ];

    const responses = await Promise.all(
      outsideEvents.map(postTelemetry)
    );

    const requestsPassed = responses.every(
      (item) =>
        item.status === 200 &&
        item.body.success === true &&
        item.body.duplicate === false
    );

    console.log(
      "2. Both concurrent HTTP requests stored:",
      requestsPassed ? "PASS" : "FAIL"
    );

    if (!requestsPassed) {
      console.log("HTTP responses:", JSON.stringify(responses, null, 2));
    }

    const events = await db.collection("telemetryEvents")
      .find({ _id: { $in: eventIds } })
      .toArray();

    const eventPersistencePassed = events.length === 3;

    console.log(
      "3. All three telemetry event records persisted:",
      eventPersistencePassed ? "PASS" : "FAIL",
      `(${events.length}/3)`
    );

    const bucketReadings = await db.collection("telemetryBuckets")
      .aggregate([
        { $match: { vehicleId } },
        { $unwind: "$readings" },
        { $match: { "readings.eventId": { $in: eventIds } } },
        { $count: "total" },
      ])
      .toArray();

    const readingCount = bucketReadings[0]?.total || 0;
    const bucketPassed = readingCount === 3;

    console.log(
      "4. All three bucket readings persisted:",
      bucketPassed ? "PASS" : "FAIL",
      `(${readingCount}/3)`
    );

    const savedAlerts = await db.collection("geofenceAlerts")
      .find({
        vehicleId,
        geofenceId,
        type: "GEOFENCE_BREACH",
      })
      .toArray();

    const alertPassed =
      savedAlerts.length === 1 &&
      eventIds.slice(1).includes(savedAlerts[0].eventId);

    console.log(
      "5. Exactly one geofence breach alert persisted:",
      alertPassed ? "PASS" : "FAIL",
      `(${savedAlerts.length})`
    );

    if (savedAlerts.length > 0) {
      console.log("Alert event ID:", savedAlerts[0].eventId);
    }

    testPassed =
      requestsPassed &&
      eventPersistencePassed &&
      bucketPassed &&
      alertPassed;

    console.log(
      "\nFINAL RESULT:",
      testPassed ? "ALL CHECKS PASSED" : "TEST FAILED"
    );
  } finally {
    if (db) {
      // Remove only records created by this unique test vehicle/event IDs.
      await Promise.all([
        db.collection("telemetryEvents").deleteMany({
          _id: { $in: eventIds },
        }),
        db.collection("telemetryOutbox").deleteMany({
          _id: { $in: eventIds },
        }),
        db.collection("geofenceAlerts").deleteMany({
          vehicleId,
          geofenceId,
        }),
        db.collection("telemetryBuckets").deleteMany({
          vehicleId,
        }),
      ]);
    }

    try {
      await publisher.del(stateKey, positionKey);
    } finally {
      await Promise.allSettled([
        publisher.quit(),
        subscriber.quit(),
      ]);

      if (db) {
        await closeDatabase();
      }
    }

    console.log("Test data cleanup completed.");
  }

  if (!testPassed) {
    process.exitCode = 1;
  }
}

runTest().catch((error) => {
  console.error("Concurrent geofence test failed:", error);
  process.exitCode = 1;
});
