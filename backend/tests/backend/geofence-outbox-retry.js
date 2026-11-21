require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { connectDatabase, closeDatabase } = require("../../config/database");
const { connectRedis, publisher, subscriber } = require("../../config/redisClient");
const {
  flushPendingGeofenceAlerts,
} = require("../../services/geofenceAlertOutbox");

const CHANNEL = "fleetdash:geofence-alerts";
const testId = `OUTBOX-RETRY-${randomUUID()}`;
const alertId = `${testId}-ALERT`;

let db;
let subscribed = false;
let inserted = false;
let originalPublish;
const received = [];

async function run() {
  try {
    db = await connectDatabase();
    await connectRedis();

    const collection = db.collection("geofenceAlerts");

    const otherEligible = await collection.findOne({
      _id: { $ne: alertId },
      $or: [
        {
          deliveryStatus: "PENDING",
          $or: [
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: { $lte: new Date() } },
          ],
        },
        {
          deliveryStatus: "PROCESSING",
          leaseUntil: { $lte: new Date() },
        },
      ],
    });

    if (otherEligible) {
      throw new Error(
        `Safety stop: another eligible alert exists (${otherEligible._id}).`
      );
    }

    await subscriber.subscribe(CHANNEL, (message) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed._id === alertId) received.push(parsed);
      } catch {}
    });
    subscribed = true;

    await collection.insertOne({
      _id: alertId,
      eventId: `${testId}-EVENT`,
      vehicleId: `${testId}-VEHICLE`,
      geofenceId: "DURGAPUR-DEMO-ZONE",
      geofenceName: "FleetDash Demo Zone",
      type: "GEOFENCE_BREACH",
      message: "Geofence outbox retry integration test",
      latitude: 28.614,
      longitude: 77.22,
      timestamp: new Date(),
      deliveryStatus: "PENDING",
      createdAt: new Date(),
      publishedAt: null,
    });
    inserted = true;

    console.log("\n--- GEOFENCE OUTBOX RETRY TEST ---");
    console.log("Test ID:", testId);

    originalPublish = publisher.publish;

    publisher.publish = async () => {
      throw new Error("Simulated Redis publish failure");
    };

    const firstCount = await flushPendingGeofenceAlerts();

    publisher.publish = originalPublish;
    originalPublish = null;

    const afterFailure = await collection.findOne({ _id: alertId });

    const retryScheduled =
      firstCount === 0 &&
      afterFailure?.deliveryStatus === "PENDING" &&
      afterFailure?.attempts === 1 &&
      afterFailure?.lastError === "Simulated Redis publish failure" &&
      afterFailure?.nextAttemptAt instanceof Date;

    console.log(
      "1. Redis failure scheduled a retry:",
      retryScheduled ? "PASS" : "FAIL"
    );

    if (!retryScheduled) {
      throw new Error(
        `Unexpected post-failure record: ${JSON.stringify(afterFailure)}`
      );
    }

    const waitMs = Math.max(
      0,
      afterFailure.nextAttemptAt.getTime() - Date.now() + 150
    );

    console.log(`Waiting ${waitMs} ms for retry eligibility...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    const secondCount = await flushPendingGeofenceAlerts();

    const afterRetry = await collection.findOne({ _id: alertId });

    await new Promise((resolve) => setTimeout(resolve, 250));

    const deliveryPassed =
      secondCount === 1 &&
      afterRetry?.deliveryStatus === "PUBLISHED" &&
      afterRetry?.attempts === 2 &&
      received.length === 1;

    console.log(
      "2. Retry successfully published to Redis:",
      deliveryPassed ? "PASS" : "FAIL",
      `(${received.length} message received)`
    );

    console.log(
      "3. MongoDB marked alert PUBLISHED after retry:",
      afterRetry?.deliveryStatus === "PUBLISHED" &&
        afterRetry?.attempts === 2
        ? "PASS"
        : "FAIL",
      `(status: ${afterRetry?.deliveryStatus}, attempts: ${afterRetry?.attempts})`
    );

    if (!retryScheduled || !deliveryPassed) {
      throw new Error("One or more retry checks failed.");
    }

    console.log("\nFINAL RESULT: ALL CHECKS PASSED");
  } finally {
    if (originalPublish) {
      publisher.publish = originalPublish;
    }

    if (db && inserted) {
      await db.collection("geofenceAlerts").deleteOne({ _id: alertId });
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
  console.error("Geofence outbox retry test failed:", error);
  process.exitCode = 1;
});
