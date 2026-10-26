const { Worker } = require("node:worker_threads");
const os = require("node:os");
const path = require("node:path");

const workerPath = path.join(__dirname, "../workers/telemetryWorker.js");

const cpuCount =
  typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;

const configuredSize = Number.parseInt(
  process.env.TELEMETRY_WORKERS || "",
  10
);

const poolSize =
  Number.isInteger(configuredSize) && configuredSize > 0
    ? Math.min(configuredSize, 16)
    : Math.max(1, Math.min(4, cpuCount));

const configuredQueueSize = Number.parseInt(
  process.env.TELEMETRY_WORKER_MAX_QUEUE || "",
  10
);

const maxQueue =
  Number.isInteger(configuredQueueSize) && configuredQueueSize > 0
    ? configuredQueueSize
    : 1000;

const slots = [];
const queue = [];

let initialized = false;
let closing = false;

function dispatch() {
  if (closing) return;

  for (const slot of slots) {
    if (!slot.worker || slot.current || queue.length === 0) {
      continue;
    }

    const job = queue.shift();
    slot.current = job;

    try {
      slot.worker.postMessage(job.data);
    } catch (error) {
      slot.current = null;
      job.reject(error);
    }
  }

  // If a slot failed to accept a message, continue assigning
  // remaining queued jobs to other available workers.
  if (!closing && queue.length > 0) {
    const hasAvailableWorker = slots.some(
      (slot) => slot.worker && !slot.current
    );

    if (hasAvailableWorker) {
      queueMicrotask(dispatch);
    }
  }
}

function rejectCurrentJob(slot, error) {
  const job = slot.current;
  slot.current = null;

  if (job) {
    job.reject(error);
  }
}

function scheduleRestart(slot) {
  if (closing || slot.restartScheduled) return;

  slot.restartScheduled = true;

  setTimeout(() => {
    slot.restartScheduled = false;

    if (closing || slot.worker) return;

    try {
      spawnWorker(slot);
    } catch (error) {
      console.error(
        "Failed to restart telemetry worker:",
        error.message
      );
      scheduleRestart(slot);
    }
  }, 100);
}

function spawnWorker(slot) {
  if (closing || slot.worker) return;

  const worker = new Worker(workerPath);
  slot.worker = worker;

  worker.on("message", (result) => {
    if (slot.worker !== worker) return;

    const job = slot.current;
    if (!job) return;

    slot.current = null;
    job.resolve(result);

    dispatch();
  });

  worker.on("error", (error) => {
    if (slot.worker !== worker) return;

    rejectCurrentJob(slot, error);
    console.error("Telemetry worker error:", error.message);
  });

  worker.on("exit", (code) => {
    if (slot.worker !== worker) return;

    slot.worker = null;

    if (slot.current) {
      rejectCurrentJob(
        slot,
        new Error(`Telemetry worker exited unexpectedly (${code})`)
      );
    }

    if (!closing) {
      scheduleRestart(slot);
    }
  });

  dispatch();
}

function initializeTelemetryWorkerPool() {
  if (initialized || closing) return;

  initialized = true;

  for (let i = 0; i < poolSize; i++) {
    const slot = {
      worker: null,
      current: null,
      restartScheduled: false,
    };

    slots.push(slot);

    try {
      spawnWorker(slot);
    } catch (error) {
      console.error(
        "Failed to start telemetry worker:",
        error.message
      );
      scheduleRestart(slot);
    }
  }

  console.log(
    `Telemetry worker pool initialized: ${poolSize} workers, queue limit ${maxQueue}`
  );
}

function processTelemetry(data) {
  initializeTelemetryWorkerPool();

  return new Promise((resolve, reject) => {
    if (closing) {
      reject(new Error("Telemetry worker pool is shutting down"));
      return;
    }

    if (queue.length >= maxQueue) {
      const error = new Error("Telemetry processing queue is full");
      error.code = "WORKER_QUEUE_FULL";
      reject(error);
      return;
    }

    queue.push({ data, resolve, reject });
    dispatch();
  });
}

async function closeTelemetryWorkerPool() {
  if (closing) return;

  closing = true;

  const shutdownError = new Error(
    "Telemetry worker pool is shutting down"
  );

  while (queue.length) {
    queue.shift().reject(shutdownError);
  }

  await Promise.all(
    slots.map(async (slot) => {
      if (slot.current) {
        rejectCurrentJob(slot, shutdownError);
      }

      if (slot.worker) {
        const worker = slot.worker;
        slot.worker = null;
        await worker.terminate();
      }
    })
  );
}

async function simulateWorkerFailureForTest() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Worker failure simulation is only allowed in test mode"
    );
  }

  const slot = slots.find(
    (item) => item.worker && !item.current
  );

  if (!slot) {
    throw new Error("No idle worker available for failure simulation");
  }

  await slot.worker.terminate();
}

module.exports = {
  initializeTelemetryWorkerPool,
  processTelemetry,
  closeTelemetryWorkerPool,
  simulateWorkerFailureForTest,
};
