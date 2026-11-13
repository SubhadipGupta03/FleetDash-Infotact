
const geofences = require("../config/geofences");
const {
  checkGeofence,
  isValidPosition,
  hasBoundaryIntersection,
} = require("./geofenceService");
const { publisher } = require("../config/redisClient");
const { getDatabase } = require("../config/database");
const {
  flushPendingGeofenceAlerts,
} = require("./geofenceAlertOutbox");

const vehicleQueues = new Map();

function enqueueVehicle(vehicleId, task) {
  const previous = vehicleQueues.get(vehicleId) || Promise.resolve();

  const current = previous
    .catch(() => {})
    .then(task);

  const tracked = current.finally(() => {
    if (vehicleQueues.get(vehicleId) === tracked) {
      vehicleQueues.delete(vehicleId);
    }
  });

  vehicleQueues.set(vehicleId, tracked);

  return tracked;
}

function parsePreviousPosition(raw) {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    if (!isValidPosition(parsed)) {
      return null;
    }

    const timestamp = new Date(parsed.timestamp).getTime();

    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
    };
  } catch {
    return null;
  }
}

async function processVehicleGeofenceAlerts(telemetry) {
  if (
    !telemetry ||
    typeof telemetry.vehicleId !== "string" ||
    telemetry.vehicleId.trim() === "" ||
    !isValidPosition(telemetry)
  ) {
    throw new Error("Invalid telemetry supplied to geofence processing");
  }

  const eventTimestamp = new Date(telemetry.timestamp).getTime();

  if (!Number.isFinite(eventTimestamp)) {
    throw new Error("Invalid telemetry timestamp for geofence processing");
  }

  if (
    typeof telemetry.eventId !== "string" ||
    telemetry.eventId.trim() === ""
  ) {
    throw new Error("eventId is required for geofence processing");
  }

  const results = checkGeofence(
    telemetry.latitude,
    telemetry.longitude
  );

  const db = getDatabase();
  const alerts = [];

  for (const result of results) {
    const stateKey = [
      "fleetdash",
      "geofence-state",
      encodeURIComponent(telemetry.vehicleId),
      encodeURIComponent(result.geofenceId),
    ].join(":");

    const positionKey = `${stateKey}:position`;

    const [previousState, previousPositionRaw] = await Promise.all([
      publisher.get(stateKey),
      publisher.get(positionKey),
    ]);

    const previousPosition = parsePreviousPosition(previousPositionRaw);

    // Never allow an older GPS event to overwrite newer state.
    if (
      previousPosition?.timestamp !== null &&
      previousPosition?.timestamp !== undefined &&
      eventTimestamp < previousPosition.timestamp
    ) {
      continue;
    }

    const geofence = geofences.find(
      (item) => item.id === result.geofenceId
    );

    const isBreach =
      previousState === "INSIDE" &&
      result.status === "OUTSIDE" &&
      hasBoundaryIntersection(
        previousPosition,
        telemetry,
        geofence
      );

    if (isBreach) {
      const alert = {
        _id: `${telemetry.eventId}:${result.geofenceId}`,
        eventId: telemetry.eventId,
        vehicleId: telemetry.vehicleId,
        geofenceId: result.geofenceId,
        geofenceName: result.geofenceName,
        type: "GEOFENCE_BREACH",
        message: `Vehicle ${telemetry.vehicleId} exited ${result.geofenceName}`,
        latitude: telemetry.latitude,
        longitude: telemetry.longitude,
        timestamp: new Date(eventTimestamp),
        deliveryStatus: "PENDING",
        createdAt: new Date(),
        publishedAt: null,
      };

      try {
        await db.collection("geofenceAlerts").insertOne(alert);
        alerts.push(alert);
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }

        // An existing pending alert remains eligible for outbox delivery.
      }
    }

    await publisher.set(stateKey, result.status);

    await publisher.set(
      positionKey,
      JSON.stringify({
        latitude: telemetry.latitude,
        longitude: telemetry.longitude,
        timestamp: new Date(eventTimestamp).toISOString(),
      })
    );
  }

  if (alerts.length > 0) {
    await flushPendingGeofenceAlerts();
  }

  return alerts;
}

function processGeofenceAlerts(telemetry) {
  const vehicleId = telemetry?.vehicleId;

  if (typeof vehicleId !== "string" || vehicleId.trim() === "") {
    return Promise.reject(new Error("vehicleId is required"));
  }

  return enqueueVehicle(vehicleId, () =>
    processVehicleGeofenceAlerts(telemetry)
  );
}

module.exports = {
  processGeofenceAlerts,
};
