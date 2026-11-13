
const { getDatabase } = require("../config/database");
const { publisher } = require("../config/redisClient");

const GEOFENCE_ALERT_CHANNEL = "fleetdash:geofence-alerts";
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_BATCH_SIZE = 100;

let retryTimer = null;
let activeFlush = null;

async function ensureGeofenceAlertOutboxIndexes() {
  const db = getDatabase();

  await db.collection("geofenceAlerts").createIndex(
    { deliveryStatus: 1, createdAt: 1 },
    { name: "geofence_alert_outbox_status_created" }
  );
}

async function flushPendingGeofenceAlerts() {
  if (activeFlush) {
    return activeFlush;
  }

  activeFlush = (async () => {
    const db = getDatabase();
    const collection = db.collection("geofenceAlerts");

    const pendingAlerts = await collection
      .find({ deliveryStatus: "PENDING" })
      .sort({ createdAt: 1, _id: 1 })
      .limit(DEFAULT_BATCH_SIZE)
      .toArray();

    let publishedCount = 0;

    for (const alert of pendingAlerts) {
      try {
        // Publish the alert to the Redis Cluster channel.
        // Do not use the returned subscriber count as a delivery check.
        await publisher.publish(
          GEOFENCE_ALERT_CHANNEL,
          JSON.stringify(alert)
        );

        // Mark as published only after Redis accepts the command.
        const result = await collection.updateOne(
          {
            _id: alert._id,
            deliveryStatus: "PENDING",
          },
          {
            $set: {
              deliveryStatus: "PUBLISHED",
              publishedAt: new Date(),
            },
          }
        );

        if (result.modifiedCount === 1) {
          publishedCount += 1;
        }
      } catch (error) {
        console.error(
          `Geofence alert delivery failed (${alert._id}):`,
          error.message
        );
      }
    }

    return publishedCount;
  })();

  try {
    return await activeFlush;
  } finally {
    activeFlush = null;
  }
}

function startGeofenceAlertOutbox(intervalMs = DEFAULT_INTERVAL_MS) {
  if (retryTimer) {
    return;
  }

  void flushPendingGeofenceAlerts().catch((error) => {
    console.error("Initial geofence outbox flush failed:", error.message);
  });

  retryTimer = setInterval(() => {
    void flushPendingGeofenceAlerts().catch((error) => {
      console.error("Geofence outbox retry failed:", error.message);
    });
  }, intervalMs);

  retryTimer.unref?.();

  console.log(
    `Geofence alert outbox started (retry interval: ${intervalMs} ms)`
  );
}

async function stopGeofenceAlertOutbox() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }

  if (activeFlush) {
    await activeFlush;
  }

  console.log("Geofence alert outbox stopped");
}

module.exports = {
  ensureGeofenceAlertOutboxIndexes,
  flushPendingGeofenceAlerts,
  startGeofenceAlertOutbox,
  stopGeofenceAlertOutbox,
};
