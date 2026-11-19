const { randomUUID } = require("crypto");
const { getDatabase } = require("../config/database");
const { publisher } = require("../config/redisClient");

const TELEMETRY_CHANNEL = "fleetdash:telemetry";

const FLUSH_INTERVAL_MS = 2000;
const BATCH_SIZE = 100;
const LEASE_MS = 60_000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60_000;

let flushTimer = null;
let activeFlush = null;

async function ensureTelemetryOutboxIndexes() {
  const collection = getDatabase().collection("telemetryOutbox");

  await collection.createIndex(
    { deliveryStatus: 1, createdAt: 1, _id: 1 },
    { name: "telemetry_outbox_pending" }
  );

  await collection.createIndex(
    { deliveryStatus: 1, nextAttemptAt: 1, createdAt: 1 },
    { name: "telemetry_outbox_retry" }
  );

  await collection.createIndex(
    { deliveryStatus: 1, leaseUntil: 1, createdAt: 1 },
    { name: "telemetry_outbox_lease" }
  );
}

async function claimNextTelemetry() {
  const collection = getDatabase().collection("telemetryOutbox");
  const now = new Date();
  const claimToken = randomUUID();

  const result = await collection.findOneAndUpdate(
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
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { createdAt: 1, _id: 1 },
      returnDocument: "after",
    }
  );

  return result;
}

async function markTelemetryPublished(event) {
  const collection = getDatabase().collection("telemetryOutbox");

  const result = await collection.updateOne(
    {
      _id: event._id,
      deliveryStatus: "PROCESSING",
      claimToken: event.claimToken,
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

async function scheduleTelemetryRetry(event, error) {
  const collection = getDatabase().collection("telemetryOutbox");

  const attempts = Math.max(1, event.attempts || 1);
  const delay = Math.min(
    RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 5),
    RETRY_MAX_MS
  );

  await collection.updateOne(
    {
      _id: event._id,
      deliveryStatus: "PROCESSING",
      claimToken: event.claimToken,
    },
    {
      $set: {
        deliveryStatus: "PENDING",
        nextAttemptAt: new Date(Date.now() + delay),
        lastError: String(error.message || error).slice(0, 1000),
      },
      $unset: {
        claimToken: "",
        claimedAt: "",
        leaseUntil: "",
      },
    }
  );
}

async function flushPendingTelemetry() {
  if (activeFlush) {
    return activeFlush;
  }

  activeFlush = (async () => {
    const collection = getDatabase().collection("telemetryOutbox");

    for (let i = 0; i < BATCH_SIZE; i += 1) {
      let event;

      try {
        event = await claimNextTelemetry();
      } catch (error) {
        console.error(
          "Telemetry outbox claim failed:",
          error.message
        );
        break;
      }

      if (!event) {
        break;
      }

      try {
        await publisher.publish(
          TELEMETRY_CHANNEL,
          JSON.stringify(event.telemetry)
        );

        const marked = await markTelemetryPublished(event);

        if (!marked) {
          console.warn(
            `Telemetry outbox claim was lost for event ${event.eventId}`
          );
        }
      } catch (error) {
        console.error(
          `Telemetry outbox delivery failed for ${event.eventId}:`,
          error.message
        );

        try {
          await scheduleTelemetryRetry(event, error);
        } catch (retryError) {
          console.error(
            `Telemetry outbox retry scheduling failed for ${event.eventId}:`,
            retryError.message
          );
        }
      }
    }
  })();

  try {
    await activeFlush;
  } finally {
    activeFlush = null;
  }
}

function startTelemetryOutbox() {
  if (flushTimer) {
    return;
  }

  flushPendingTelemetry().catch((error) => {
    console.error("Telemetry outbox flush failed:", error.message);
  });

  flushTimer = setInterval(() => {
    flushPendingTelemetry().catch((error) => {
      console.error("Telemetry outbox flush failed:", error.message);
    });
  }, FLUSH_INTERVAL_MS);

  if (typeof flushTimer.unref === "function") {
    flushTimer.unref();
  }
}

async function stopTelemetryOutbox() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  if (activeFlush) {
    await activeFlush;
  }
}

module.exports = {
  ensureTelemetryOutboxIndexes,
  flushPendingTelemetry,
  startTelemetryOutbox,
  stopTelemetryOutbox,
};