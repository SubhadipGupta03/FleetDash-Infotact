require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { connectDatabase, closeDatabase } = require("../../config/database");
const { connectRedis, publisher, subscriber } = require("../../config/redisClient");
const {
  flushPendingGeofenceAlerts,
} = require("../../services/geofenceAlertOutbox");

const CHANNEL = "fleetdash:geofence-alerts";
const testId = `OUTBOX-RECOVERY-${randomUUID()}`;

const alerts = [
  {
    _id: `${testId}-PENDING`,
    eventId: `${testId}-EVENT-1`,
    vehicleId: `${testId}-VEHICLE`,
    geofenceId: "DURGAPUR-DEMO-ZONE",
    geofenceName: "FleetDash Demo Zone",
    type: "GEOFENCE_BREACH",
    message: "Outbox pending delivery test",
    latitude: 28.614,
    longitude: 77.22,
    timestamp: new Date(),
    deliveryStatus: "PENDING",
    createdAt: new Date(),
    publishedAt: null,
  },
  {
    _id: `${testId}-EXPIRED`,
    eventId: `${testId}-EVENT-2`,
    vehicleId: `${testId}-VEHICLE`,
    geofenceId: "DURGAPUR-DEMO-ZONE",
    geofenceName: "FleetDash Demo Zone",
    type: "GEOFENCE_BREACH",
    message: "Outbox expired lease recovery test",
    latitude: 28.614,
    longitude: 77.225,
    timestamp: new Date(),
    deliveryStatus: "PROCESSING",
    claimToken: "expired-test-claim",
    claimedAt: new Date(Date.now() - 120000),
    leaseUntil: new Date(Date.now() - 60000),
    attempts: 1,
    createdAt: new Date(Date.now() + 1),
    publishedAt: null,
  },
];

async function run() {
  let db;
  let subscribed = false;
  let inserted = false;
  const received = [];

  const onMessage = (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed._id?.startsWith(testId)) received.push(parsed);
    } catch {}
  };

  try {
    db = await connectDatabase();
    await connectRedis();

    const collection = db.collection("geofenceAlerts");
    const now = new Date();

    const otherEligible = await collection.findOne({
      _id: { $not: { $regex: `^${testId}` } },
      $or: [
        {
          deliveryStatus: "PENDING",
          $or: [
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: { $lte: now } },
          ],
        },
        {
          deliveryStatus: "PROCESSING",
          leaseUntil: { $lte: now },
        },
      ],
    });

    if (otherEligible) {
      throw new Error(
        `Safety stop: another eligible alert exists (${otherEligible._id}). No flush performed.`
      );
    }

    await subscriber.subscribe(CHANNEL, onMessage);
    subscribed = true;

    await collection.insertMany(alerts);
    inserted = true;

    console.log("\n--- GEOFENCE OUTBOX RECOVERY TEST ---");
    console.log("Test ID:", testId);

    const results = await Promise.all([
      flushPendingGeofenceAlerts(),
      flushPendingGeofenceAlerts(),
      flushPendingGeofenceAlerts(),
    ]);

    const saved = await collection.find({
      _id: { $in: alerts.map((item) => item._id) },
    }).toArray();

    const published = saved.filter(
      (item) => item.deliveryStatus === "PUBLISHED"
    );

    const deliveryPassed =
      published.length === 2 &&
      received.length === 2 &&
      new Set(received.map((item) => item._id)).size === 2;

    console.log(
      "1. Pending and expired-lease alerts delivered:",
      deliveryPassed ? "PASS" : "FAIL",
      `(${received.length}/2 Redis messages)`
    );

    console.log(
      "2. Both MongoDB records marked PUBLISHED:",
      published.length === 2 ? "PASS" : "FAIL",
      `(${published.length}/2)`
    );

    console.log(
      "3. Concurrent flush calls:",
      results.every((count) => count === 2) &&
        received.length === 2
        ? "PASS"
        : "FAIL",
      `(${results.join(", ")})`
    );

    if (!deliveryPassed || published.length !== 2 ||
        !results.every((count) => count === 2) || received.length !== 2) {
      throw new Error("One or more outbox recovery checks failed.");
    }

    console.log("\nFINAL RESULT: ALL CHECKS PASSED");
  } finally {
    if (db && inserted) {
      await db.collection("geofenceAlerts").deleteMany({
        _id: { $in: alerts.map((item) => item._id) },
      });
    }

    if (subscribed) {
      await subscriber.unsubscribe(CHANNEL);
    }

    await Promise.allSettled([
      publisher.quit(),
      subscriber.quit(),
    ]);

    if (db) await closeDatabase();

    console.log("Test data cleanup completed.");
  }
}

run().catch((error) => {
  console.error("Outbox integration test failed:", error);
  process.exitCode = 1;
});
