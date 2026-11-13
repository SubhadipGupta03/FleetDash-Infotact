
const turf = require("@turf/turf");
const geofences = require("../config/geofences");

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

function checkGeofence(latitude, longitude) {
  if (
    !isValidPosition({ latitude, longitude })
  ) {
    throw new Error("Invalid latitude or longitude for geofence check");
  }

  const point = turf.point([longitude, latitude]);

  return geofences.map((geofence) => {
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

function hasBoundaryIntersection(
  previousPosition,
  currentPosition,
  geofence
) {
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

module.exports = {
  checkGeofence,
  isValidPosition,
  hasBoundaryIntersection,
};
