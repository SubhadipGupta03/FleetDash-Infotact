
const { randomUUID } = require("node:crypto");
const { getDatabase } = require("../config/database");
const { publisher } = require("../config/redisClient");

const GEOFENCE_ALERT_CHANNEL = "fleetdash:geofence-alerts";
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_BATCH_SIZE = 100;
const LEASE_DURATION_MS = 60_000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60_000;

let retryTimer = null;
let activeFlush = null;

async function ensureGeofenceAlertOutboxIndexes() {
  const collection = getDatabase().collection("geofenceAlerts");

  await collection.createIndex(
    { deliveryStatus: 1, createdAt: 1 },
    { name: "geofence_alert_outbox_status_created" }
  );

  await collection.createIndex(
    { deliveryStatus: 1, nextAttemptAt: 1, createdAt: 1 },
    { name: "geofence_alert_outbox_retry" }
  );

  await collection.createIndex(
    { deliveryStatus: 1, leaseUntil: 1, createdAt: 1 },
    { name: "geofence_alert_outbox_lease" }
  );
}

async function claimNextAlert(collection) {
  const now = new Date();
  const claimToken = randomUUID();

  return collection.findOneAndUpdate(
    {
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
    },
    {
      $set: {
        deliveryStatus: "PROCESSING",
        claimToken,
        claimedAt: now,
        leaseUntil: new Date(now.getTime() + LEASE_DURATION_MS),
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { createdAt: 1, _id: 1 },
      returnDocument: "after",
    }
  );
}

async function markAlertPublished(collection, alert) {
  const result = await collection.updateOne(
    {
      _id: alert._id,
      deliveryStatus: "PROCESSING",
      claimToken: alert.claimToken,
    },
    {
      $set: {
        deliveryStatus: "PUBLISHED",
        publishedAt: new Date(),
      },
      $unset: {
        claimToken: "",
        claimedAt: "",
        leaseUntil: "",
        nextAttemptAt: "",
        lastError: "",
      },
    }
  );

  return result.modifiedCount === 1;
}

async function scheduleAlertRetry(collection, alert, error) {
  const attempts = alert.attempts || 1;

  const delay = Math.min(
    RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 5),
    RETRY_MAX_MS
  );

  await collection.updateOne(
    {
      _id: alert._id,
      deliveryStatus: "PROCESSING",
      claimToken: alert.claimToken,
    },
    {
      $set: {
        deliveryStatus: "PENDING",
        nextAttemptAt: new Date(Date.now() + delay),
        lastError: error.message,
      },
      $unset: {
        claimToken: "",
        claimedAt: "",
        leaseUntil: "",
      },
    }
  );
}

async function flushPendingGeofenceAlerts() {
  if (activeFlush) {
    return activeFlush;
  }

  activeFlush = (async () => {
    const collection = getDatabase().collection("geofenceAlerts");
    let publishedCount = 0;

    for (let i = 0; i < DEFAULT_BATCH_SIZE; i += 1) {
      const alert = await claimNextAlert(collection);

      if (!alert) {
        break;
      }

      try {
        const {
          claimToken,
          claimedAt,
          leaseUntil,
          nextAttemptAt,
          attempts,
          lastError,
          ...publicAlert
        } = alert;

        await publisher.publish(
          GEOFENCE_ALERT_CHANNEL,
          JSON.stringify(publicAlert)
        );

        if (await markAlertPublished(collection, alert)) {
          publishedCount += 1;
        }
      } catch (error) {
        console.error(
          `Geofence alert delivery failed (${alert._id}):`,
          error.message
        );

        try {
          await scheduleAlertRetry(collection, alert, error);
        } catch (retryError) {
          console.error(
            `Failed to schedule geofence alert retry (${alert._id}):`,
            retryError.message
          );
        }
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
