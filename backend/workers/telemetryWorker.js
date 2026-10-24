
const { parentPort } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");

function processTelemetry(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Telemetry data must be an object");
  }

  const { vehicleId, latitude, longitude, timestamp } = data;

  if (typeof vehicleId !== "string" || vehicleId.trim() === "") {
    throw new Error("vehicleId must be a non-empty string");
  }

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error("latitude must be a number between -90 and 90");
  }

  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("longitude must be a number between -180 and 180");
  }

  const parsedTimestamp = timestamp
    ? new Date(timestamp)
    : new Date();

  if (Number.isNaN(parsedTimestamp.getTime())) {
    throw new Error("timestamp must be a valid date");
  }

  return {
    vehicleId: vehicleId.trim(),
    latitude,
    longitude,
    timestamp: parsedTimestamp.toISOString(),
  };
}

parentPort.on("message", (data) => {
  try {
    const workerStart = performance.now();
    const telemetry = processTelemetry(data);
    const workerDurationMs = performance.now() - workerStart;

    parentPort.postMessage({
      success: true,
      telemetry,
      workerDurationMs,
    });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error.message,
    });
  }
});