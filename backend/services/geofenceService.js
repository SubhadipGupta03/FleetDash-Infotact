
const turf = require("@turf/turf");
const geofences = require("../config/geofences");

function checkGeofence(latitude, longitude) {
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

module.exports = {
  checkGeofence,
};
