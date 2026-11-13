
require("dotenv").config();

const {
  connectDatabase,
  closeDatabase,
  getDatabase,
} = require("../../config/database");

const {
  connectRedis,
  publisher,
  subscriber,
} = require("../../config/redisClient");

const {
  processGeofenceAlerts,
} = require("../../services/geofenceAlertService");

async function runTest() {
  const vehicleId = `GEOFENCE-TEST-${Date.now()}`;
  const geofenceId = "DURGAPUR-DEMO-ZONE";

  const stateKey = [
    "fleetdash",
    "geofence-state",
    encodeURIComponent(vehicleId),
    encodeURIComponent(geofenceId),
  ].join(":");

  const positionKey = `${stateKey}:position`;

  const eventIds = [
    `${vehicleId}-INSIDE`,
    `${vehicleId}-EXIT`,
    `${vehicleId}-OUTSIDE`,
  ];

  const db = await connectDatabase();
  await connectRedis();

  try {
    console.log("\n--- GEOFENCE INTEGRATION TEST ---");

    const first = await processGeofenceAlerts({
      eventId: eventIds[0],
      vehicleId,
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: new Date().toISOString(),
    });

    console.log("1. Initial inside reading:", first.length === 0 ? "PASS" : "FAIL");

    const second = await processGeofenceAlerts({
      eventId: eventIds[1],
      vehicleId,
      latitude: 28.6140,
      longitude: 77.2200,
      timestamp: new Date().toISOString(),
    });

    console.log(
      "2. Boundary crossing:",
      second.length === 1 &&
      second[0].type === "GEOFENCE_BREACH"
        ? "PASS"
        : "FAIL"
    );

    const third = await processGeofenceAlerts({
      eventId: eventIds[2],
      vehicleId,
      latitude: 28.6140,
      longitude: 77.2250,
      timestamp: new Date().toISOString(),
    });

    console.log("3. Remaining outside:", third.length === 0 ? "PASS" : "FAIL");

    const savedAlert = await db
      .collection("geofenceAlerts")
      .findOne({ _id: `${eventIds[1]}:${geofenceId}` });

    console.log(
      "4. MongoDB alert persistence:",
      savedAlert ? "PASS" : "FAIL"
    );

    const passed =
      first.length === 0 &&
      second.length === 1 &&
      third.length === 0 &&
      Boolean(savedAlert);

    console.log(
      "\nFINAL RESULT:",
      passed ? "ALL TESTS PASSED" : "SOME TESTS FAILED"
    );

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    // Remove only this test vehicle's Redis state and MongoDB alert.
    await publisher.del(stateKey, positionKey);

    await db.collection("geofenceAlerts").deleteMany({
      vehicleId,
    });

    await Promise.all([
      publisher.quit(),
      subscriber.quit(),
    ]);

    await closeDatabase();

    console.log("Test data cleanup completed.");
  }
}

runTest().catch((error) => {
  console.error("Geofence integration test failed:", error);
  process.exitCode = 1;
});
