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
let closePromise = null;

const INITIAL_RESTART_DELAY_MS = 100;
const MAX_RESTART_DELAY_MS = 5000;

function createPoolError(message, code) {
  const error = new Error(message);

  if (code) {
    error.code = code;
  }

  return error;
}

function rejectCurrentJob(slot, error) {
  const job = slot.current;
  slot.current = null;

  if (job) {
    job.reject(error);
  }
}

function dispatch() {
  if (closing) return;

  for (const slot of slots) {
    if (
      !slot.worker ||
      slot.failed ||
      slot.current ||
      queue.length === 0
    ) {
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

  if (!closing && queue.length > 0) {
    const hasAvailableWorker = slots.some(
      (slot) => slot.worker && !slot.failed && !slot.current
    );

    if (hasAvailableWorker) {
      queueMicrotask(dispatch);
    }
  }
}

function scheduleRestart(slot) {
  if (closing || slot.restartTimer) return;

  const delay = Math.min(
    INITIAL_RESTART_DELAY_MS * 2 ** slot.restartAttempts,
    MAX_RESTART_DELAY_MS
  );

  slot.restartAttempts += 1;

  slot.restartTimer = setTimeout(() => {
    slot.restartTimer = null;

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
  }, delay);

  // A pending restart timer should not keep the process alive by itself.
  slot.restartTimer.unref?.();
}

function handleWorkerFailure(slot, worker, error) {
  if (slot.worker !== worker || slot.failed) return;

  slot.failed = true;

  rejectCurrentJob(
    slot,
    createPoolError(
      `Telemetry worker failed: ${error.message}`,
      "WORKER_FAILED"
    )
  );

  console.error("Telemetry worker failure:", error.message);

  // The exit handler will detach this worker and schedule its replacement.
}

function spawnWorker(slot) {
  if (closing || slot.worker) return;

  const worker = new Worker(workerPath);

  slot.worker = worker;
  slot.failed = false;

  worker.on("message", (result) => {
    if (slot.worker !== worker || slot.failed || closing) return;

    const job = slot.current;

    if (!job) {
      console.error("Telemetry worker returned an unexpected message");
      return;
    }

    slot.current = null;

    if (
      !result ||
      typeof result !== "object" ||
      typeof result.success !== "boolean"
    ) {
      job.reject(
        createPoolError(
          "Telemetry worker returned an invalid response",
          "WORKER_INVALID_RESPONSE"
        )
      );
    } else {
      job.resolve(result);
    }

    dispatch();
  });

  worker.on("messageerror", (error) => {
    handleWorkerFailure(slot, worker, error);
  });

  worker.on("error", (error) => {
    handleWorkerFailure(slot, worker, error);
  });

  worker.on("exit", (code) => {
    if (slot.worker !== worker) return;

    slot.worker = null;
    slot.failed = false;

    if (slot.current) {
      rejectCurrentJob(
        slot,
        createPoolError(
          `Telemetry worker exited before completing its job (code ${code})`,
          "WORKER_EXITED"
        )
      );
    }

    if (closing) return;

    if (code !== 0) {
      console.error(`Telemetry worker exited with code ${code}`);
    }

    scheduleRestart(slot);
    dispatch();
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
      failed: false,
      restartTimer: null,
      restartAttempts: 0,
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
      reject(
        createPoolError(
          "Telemetry worker pool is shutting down",
          "WORKER_POOL_CLOSING"
        )
      );
      return;
    }

    if (queue.length >= maxQueue) {
      reject(
        createPoolError(
          "Telemetry processing queue is full",
          "WORKER_QUEUE_FULL"
        )
      );
      return;
    }

    queue.push({ data, resolve, reject });
    dispatch();
  });
}

function closeTelemetryWorkerPool() {
  if (closePromise) return closePromise;

  closing = true;

  closePromise = (async () => {
    const shutdownError = createPoolError(
      "Telemetry worker pool is shutting down",
      "WORKER_POOL_CLOSING"
    );

    while (queue.length > 0) {
      queue.shift().reject(shutdownError);
    }

    await Promise.all(
      slots.map(async (slot) => {
        if (slot.restartTimer) {
          clearTimeout(slot.restartTimer);
          slot.restartTimer = null;
        }

        if (slot.current) {
          rejectCurrentJob(slot, shutdownError);
        }

        const worker = slot.worker;
        slot.worker = null;
        slot.failed = true;

        if (worker) {
          try {
            await worker.terminate();
          } catch (error) {
            console.error(
              "Error terminating telemetry worker:",
              error.message
            );
          }
        }
      })
    );
  })();

  return closePromise;
}

async function simulateWorkerFailureForTest() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Worker failure simulation is only allowed in test mode"
    );
  }

  const slot = slots.find(
    (item) => item.worker && !item.current && !item.failed
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