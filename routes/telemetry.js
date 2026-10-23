const { storeTelemetry } = require("../config/telemetryBuckets");
const express = require("express");
const { Worker } = require("node:worker_threads");
const path = require("node:path");
const { publisher } = require("../config/redisClient");
const router = express.Router();

router.post("/ingest", (req, res) => {
  const worker = new Worker(
    path.join(__dirname, "../workers/telemetryWorker.js")
  );

  let responded = false;

  function sendResponse(statusCode, body) {
    if (responded) return;
    responded = true;
    res.status(statusCode).json(body);
  }

  
worker.once("message", async (result) => {
  try {
    if (!result.success) {
      sendResponse(400, {
        success: false,
        error: result.error,
      });
      return;
    }

    const bucket = await storeTelemetry(result.telemetry);
await publisher.publish(
  "fleetdash:telemetry",
  JSON.stringify(result.telemetry)
);
    sendResponse(200, {
      success: true,
      message: "Telemetry processed and stored successfully",
      telemetry: result.telemetry,
      bucket,
    });
  } catch (error) {
    console.error("Telemetry storage error:", error.message);

    sendResponse(500, {
      success: false,
      error: "Failed to store telemetry",
    });
  } finally {
    await worker.terminate();
  }
});


  worker.once("error", (error) => {
    console.error("Telemetry worker error:", error.message);

    sendResponse(500, {
      success: false,
      error: "Telemetry processing failed",
    });
  });

  worker.once("exit", (code) => {
    if (code !== 0 && !responded) {
      sendResponse(500, {
        success: false,
        error: "Telemetry worker exited unexpectedly",
      });
    }
  });

  worker.postMessage(req.body);
});

module.exports = router;
