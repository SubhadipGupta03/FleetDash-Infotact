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

  if (
    timestamp === undefined ||
    timestamp === null ||
    timestamp === ""
  ) {
    throw new Error("timestamp is required");
  }

  const parsedTimestamp = new Date(timestamp);

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

if (!parentPort) {
  throw new Error("Telemetry worker must run inside a worker thread");
}

parentPort.on("message", (data) => {
  const workerStart = performance.now();

  try {
    const telemetry = processTelemetry(data);

    parentPort.postMessage({
      success: true,
      telemetry,
      workerDurationMs: performance.now() - workerStart,
    });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown telemetry validation error",
      workerDurationMs: performance.now() - workerStart,
    });
  }
});