const { createCluster } = require("redis");

const rootNodes = [7001, 7002, 7003].map((port) => ({
  url: `redis://127.0.0.1:${port}`,
}));

const subscriber = createCluster({ rootNodes });
const publisher = createCluster({ rootNodes });
const channel = "fleetdash:test:pubsub";
const expected = "fleetdash-pubsub-check";

let finished = false;
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

    timer = setTimeout(async () => {
      if (finished) return;
      finished = true;
      console.error("FAIL: Pub/Sub delivery timed out");
      await cleanup();
      process.exitCode = 1;
    }, 5000);

    await subscriber.subscribe(channel, async (message) => {
      if (finished) return;
      finished = true;

      if (message === expected) {
        console.log("PASS: Redis Cluster Pub/Sub message received correctly");
      } else {
        console.error("FAIL: Unexpected message:", message);
        process.exitCode = 1;
      }

      await cleanup();
    });

    const count = await publisher.publish(channel, expected);
    console.log("Publish recipient count:", count);

    if (count < 1 && !finished) {
      finished = true;
      console.error("FAIL: No subscribers received the message");
      process.exitCode = 1;
      await cleanup();
    }
  } catch (error) {
    console.error("FAIL:", error.message);
    process.exitCode = 1;
    await cleanup();
  }
}

runTest();
