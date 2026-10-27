require("dotenv").config();

const { createCluster } = require("redis");

const rootNodes = (
  process.env.REDIS_NODES ||
  "redis://127.0.0.1:7001,redis://127.0.0.1:7002,redis://127.0.0.1:7003"
)
  .split(",")
  .map((url) => ({ url: url.trim() }));

const publisher = createCluster({ rootNodes });
const subscriber = createCluster({ rootNodes });
const channel = `fleetdash:recovery-test:${process.pid}`;
const received = [];

let recoveryEnabled = false;
let recoveryPromise = null;

async function subscribeToChannel() {
  if (recoveryPromise) return recoveryPromise;

  recoveryPromise = subscriber.subscribe(channel, (message) => {
    received.push(message);
    console.log("Received:", message);
  });

  try {
    await recoveryPromise;
    console.log("Subscription established");
  } finally {
    recoveryPromise = null;
  }
}

subscriber.on("connect", () => {
  console.log("Subscriber connect event");
  if (recoveryEnabled) {
    void subscribeToChannel().catch((error) => {
      console.error("Resubscribe failed:", error.message);
    });
  }
});

function waitForMessage(expected, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const timer = setInterval(() => {
      if (received.includes(expected)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${expected}`));
      }
    }, 100);
  });
}

async function main() {
  try {
    await Promise.all([publisher.connect(), subscriber.connect()]);

    await subscribeToChannel();
    recoveryEnabled = true;

    await publisher.publish(channel, "before-reconnect");
    await waitForMessage("before-reconnect");
    console.log("PASS: Initial Pub/Sub delivery");

    await subscriber.disconnect();
    console.log("Subscriber disconnected");

    await subscriber.connect();
    console.log("Subscriber reconnected");

    // Wait for the connect-event recovery handler to finish.
    const deadline = Date.now() + 5000;
    while (recoveryPromise && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (recoveryPromise) {
      await recoveryPromise;
    }

    await publisher.publish(channel, "after-reconnect");
    await waitForMessage("after-reconnect");
    console.log("PASS: Pub/Sub delivery after reconnect");
  } finally {
    for (const client of [subscriber, publisher]) {
      try {
        if (client.isOpen) await client.quit();
      } catch {
        try {
          client.destroy();
        } catch {}
      }
    }
  }
}

main().catch((error) => {
  console.error("FAIL:", error.message);
  process.exitCode = 1;
});
