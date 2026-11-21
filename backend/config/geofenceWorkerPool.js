
const { Worker } = require("node:worker_threads");
const os = require("node:os");
const path = require("node:path");

const workerPath = path.join(__dirname, "../workers/geofenceWorker.js");

const cpuCount =
  typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;

const configuredSize = Number.parseInt(
  process.env.GEOFENCE_WORKERS || "",
  10
);

const poolSize =
  Number.isInteger(configuredSize) && configuredSize > 0
    ? Math.min(configuredSize, 16)
    : Math.max(1, Math.min(2, cpuCount));

const configuredQueueSize = Number.parseInt(
  process.env.GEOFENCE_WORKER_MAX_QUEUE || "",
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
        "Failed to restart geofence worker:",
        error.message
      );

      scheduleRestart(slot);
    }
  }, delay);

  slot.restartTimer.unref?.();
}

function handleWorkerFailure(slot, worker, error) {
  if (slot.worker !== worker || slot.failed) return;

  slot.failed = true;

  rejectCurrentJob(
    slot,
    createPoolError(
      `Geofence worker failed: ${error.message}`,
      "GEOFENCE_WORKER_FAILED"
    )
  );

  console.error("Geofence worker failure:", error.message);
}

function spawnWorker(slot) {
  if (closing || slot.worker) return;

  const worker = new Worker(workerPath);

  slot.worker = worker;
  slot.failed = false;

  worker.on("message", (response) => {
    if (slot.worker !== worker || slot.failed || closing) return;

    const job = slot.current;

    if (!job) {
      console.error("Geofence worker returned an unexpected message");
      return;
    }

    slot.current = null;

    if (
      !response ||
      typeof response !== "object" ||
      typeof response.success !== "boolean"
    ) {
      job.reject(
        createPoolError(
          "Geofence worker returned an invalid response",
          "GEOFENCE_WORKER_INVALID_RESPONSE"
        )
      );
    } else if (!response.success) {
      job.reject(
        createPoolError(
          response.error || "Geofence calculation failed",
          "GEOFENCE_CALCULATION_FAILED"
        )
      );
    } else {
      job.resolve(response);
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
          `Geofence worker exited before completing its job (code ${code})`,
          "GEOFENCE_WORKER_EXITED"
        )
      );
    }

    if (closing) return;

    if (code !== 0) {
      console.error(`Geofence worker exited with code ${code}`);
    }

    scheduleRestart(slot);
    dispatch();
  });

  dispatch();
}

function initializeGeofenceWorkerPool() {
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
        "Failed to start geofence worker:",
        error.message
      );

      scheduleRestart(slot);
    }
  }

  console.log(
    `Geofence worker pool initialized: ${poolSize} workers, queue limit ${maxQueue}`
  );
}

function processGeofenceTask(data) {
  initializeGeofenceWorkerPool();

  return new Promise((resolve, reject) => {
    if (closing) {
      reject(
        createPoolError(
          "Geofence worker pool is shutting down",
          "GEOFENCE_WORKER_POOL_CLOSING"
        )
      );
      return;
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      reject(
        createPoolError(
          "Geofence worker task must be an object",
          "GEOFENCE_INVALID_TASK"
        )
      );
      return;
    }

    if (queue.length >= maxQueue) {
      reject(
        createPoolError(
          "Geofence processing queue is full",
          "GEOFENCE_WORKER_QUEUE_FULL"
        )
      );
      return;
    }

    queue.push({ data, resolve, reject });
    dispatch();
  });
}

    async function simulateGeofenceWorkerFailureForTest() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Worker failure simulation is only available in test mode"
    );
  }

  const slot = slots.find(
    (item) =>
      item.worker &&
      !item.current &&
      !item.failed
  );

  if (!slot) {
    throw new Error("No idle geofence worker available for testing");
  }

  await slot.worker.terminate();
}

function closeGeofenceWorkerPool() {
  if (closePromise) return closePromise;

  closing = true;

  closePromise = (async () => {
    const shutdownError = createPoolError(
      "Geofence worker pool is shutting down",
      "GEOFENCE_WORKER_POOL_CLOSING"
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
              "Error terminating geofence worker:",
              error.message
            );
          }
        }
      })
    );
  })();

  return closePromise;
}

module.exports = {
  initializeGeofenceWorkerPool,
  processGeofenceTask,
  closeGeofenceWorkerPool,
  simulateGeofenceWorkerFailureForTest,
};
