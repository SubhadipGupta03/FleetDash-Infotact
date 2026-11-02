const { checkGeofence } = require("./geofenceService");
const { publisher } = require("../config/redisClient");
const { getDatabase } = require("../config/database");

const GEOFENCE_ALERT_CHANNEL = "fleetdash:geofence-alerts";

async function processGeofenceAlerts(telemetry) {
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

    const previousState = await publisher.get(stateKey);

    const isBreach =
      previousState === "INSIDE" &&
      result.status === "OUTSIDE";

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
        timestamp: new Date(telemetry.timestamp),
      };
       let inserted = false;

      try {
        await db.collection("geofenceAlerts").insertOne(alert);
        inserted = true;
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }
      }

            if (inserted) {
        await publisher.publish(
          GEOFENCE_ALERT_CHANNEL,
          JSON.stringify(alert)
        );

        alerts.push(alert);
      }
    }

    // Update state after processing the current reading.
    await publisher.set(stateKey, result.status);
  }

  return alerts;
}

module.exports = {
  processGeofenceAlerts,
};