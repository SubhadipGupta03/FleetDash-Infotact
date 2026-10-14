
const express = require("express");
const { Worker } = require("node:worker_threads");
const path = require("node:path");

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

  worker.once("message", (result) => {
    if (result.success) {
      sendResponse(200, {
        success: true,
        message: "Telemetry processed successfully",
        telemetry: result.telemetry,
      });
    } else {
      sendResponse(400, {
        success: false,
        error: result.error,
      });
    }

    worker.terminate();
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
