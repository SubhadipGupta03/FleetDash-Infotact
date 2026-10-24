
process.env.NODE_ENV = "test";
process.env.TELEMETRY_WORKERS = "1";

const {
  initializeTelemetryWorkerPool,
  processTelemetry,
  closeTelemetryWorkerPool,
  simulateWorkerFailureForTest,
} = require("../../config/telemetryWorkerPool");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sampleTelemetry = {
  vehicleId: "VH-WORKER-RECOVERY-TEST",
  latitude: 28.6139,
  longitude: 77.209,
  timestamp: new Date().toISOString(),
};

async function runTest() {
  let passed = false;

  try {
    console.log("TEST 1: Initialize worker pool");
    initializeTelemetryWorkerPool();

    const first = await processTelemetry(sampleTelemetry);

    if (!first.success) {
      throw new Error(`Initial telemetry failed: ${first.error}`);
    }

    console.log("PASS: Worker processed the initial telemetry");

    console.log("TEST 2: Simulate an idle worker failure");
    await simulateWorkerFailureForTest();
    console.log("Worker termination requested");

    console.log("TEST 3: Wait for automatic worker restart");
    await delay(500);

    const second = await processTelemetry(sampleTelemetry);

    if (!second.success) {
      throw new Error(`Recovery telemetry failed: ${second.error}`);
    }

    console.log("PASS: Telemetry processed after worker recovery");
    console.log("RESULT: Worker recovery test PASSED");
    passed = true;
  } catch (error) {
    console.error("RESULT: Worker recovery test FAILED");
    console.error(error.message);
  } finally {
    await closeTelemetryWorkerPool();
    console.log("Worker pool closed");
  }

  if (!passed) {
    process.exitCode = 1;
  }
}

runTest();
