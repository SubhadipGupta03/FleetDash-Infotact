const { createCluster } = require("redis");

const rootNodes = [7001, 7002, 7003].map((port) => ({
  url: `redis://127.0.0.1:${port}`,
}));

const subscriber = createCluster({ rootNodes });
const publisher = createCluster({ rootNodes });
const channel = `fleetdash:test:pubsub:${Date.now()}`;
const expected = `fleetdash-pubsub-check-${Date.now()}`;

let timer;

async function cleanup() {
  clearTimeout(timer);

  for (const client of [subscriber, publisher]) {
    try {
      if (client.isOpen) await client.quit();
    } catch (error) {
      console.error("Cleanup error:", error.message);
    }
  }
}

async function runTest() {
  try {
    subscriber.on("error", (error) =>
      console.error("Subscriber error:", error.message)
    );
    publisher.on("error", (error) =>
      console.error("Publisher error:", error.message)
    );

    await Promise.all([subscriber.connect(), publisher.connect()]);
    console.log("PASS: Both Redis Cluster clients connected");

    let resolveMessage;
    const messageReceived = new Promise((resolve) => {
      resolveMessage = resolve;
    });

    timer = setTimeout(() => resolveMessage(false), 5000);

    await subscriber.subscribe(channel, (message) => {
      if (message === expected) resolveMessage(true);
    });

    console.log("PASS: Subscription command completed");

    const recipientCount = await publisher.publish(channel, expected);
    console.log("Publish recipient count (diagnostic only):", recipientCount);

    const delivered = await messageReceived;

    if (!delivered) {
      throw new Error("Timed out waiting for the expected Pub/Sub message");
    }

    console.log("PASS: Expected message received by the Cluster subscriber");
    console.log("PASS: Redis Cluster Pub/Sub delivery verified");
  } catch (error) {
    console.error("FAIL:", error.message);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

runTest();
