
const { parentPort } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const turf = require("@turf/turf");

function isValidPosition(position) {
  return (
    position &&
    typeof position.latitude === "number" &&
    Number.isFinite(position.latitude) &&
    position.latitude >= -90 &&
    position.latitude <= 90 &&
    typeof position.longitude === "number" &&
    Number.isFinite(position.longitude) &&
    position.longitude >= -180 &&
    position.longitude <= 180
  );
}

function calculateGeofenceResults(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Geofence worker input must be an object");
  }

  const { currentPosition, geofences } = data;

  if (!isValidPosition(currentPosition)) {
    throw new Error("Invalid current position");
  }

  if (!Array.isArray(geofences)) {
    throw new Error("Geofences must be an array");
  }

  const point = turf.point([
    currentPosition.longitude,
    currentPosition.latitude,
  ]);

  return geofences.map((geofence) => {
    if (
      !geofence ||
      typeof geofence.id !== "string" ||
      typeof geofence.name !== "string" ||
      !Array.isArray(geofence.coordinates)
    ) {
      throw new Error("Invalid geofence configuration");
    }

    const polygon = turf.polygon(geofence.coordinates);
    const inside = turf.booleanPointInPolygon(point, polygon);

    return {
      geofenceId: geofence.id,
      geofenceName: geofence.name,
      vehicleInside: inside,
      status: inside ? "INSIDE" : "OUTSIDE",
    };
  });
}

function calculateBoundaryIntersection(data) {
  const { previousPosition, currentPosition, geofence } = data;

  if (
    !isValidPosition(previousPosition) ||
    !isValidPosition(currentPosition) ||
    !geofence ||
    !Array.isArray(geofence.coordinates)
  ) {
    return false;
  }

  const movementLine = turf.lineString([
    [previousPosition.longitude, previousPosition.latitude],
    [currentPosition.longitude, currentPosition.latitude],
  ]);

  const polygon = turf.polygon(geofence.coordinates);
  const boundary = turf.polygonToLine(polygon);

  const intersections = turf.lineIntersect(
    movementLine,
    boundary
  );

  return intersections.features.length > 0;
}

if (!parentPort) {
  throw new Error("Geofence worker must run inside a worker thread");
}

parentPort.on("message", (data) => {
  const workerStart = performance.now();

  try {
    let result;

    if (data?.operation === "calculate-geofences") {
      result = calculateGeofenceResults(data);
    } else if (data?.operation === "check-boundary") {
      result = calculateBoundaryIntersection(data);
    } else {
      throw new Error("Unknown geofence worker operation");
    }

    parentPort.postMessage({
      success: true,
      result,
      workerDurationMs: performance.now() - workerStart,
    });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown geofence worker error",
      workerDurationMs: performance.now() - workerStart,
    });
  }
});
