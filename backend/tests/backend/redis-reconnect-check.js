const { createCluster } = require("redis");

const rootNodes = [7001, 7002, 7003].map((port) => ({
  url: `redis://127.0.0.1:${port}`,
}));

const subscriber = createCluster({ rootNodes });
const publisher = createCluster({ rootNodes });
const channel = "fleetdash:test:reconnect";

let pendingMessage = null;

function onMessage(message) {
  if (pendingMessage && message === pendingMessage.expected) {
    const resolve = pendingMessage.resolve;
    clearTimeout(pendingMessage.timer);
    pendingMessage = null;
    resolve();
  }
}

function waitForMessage(expected, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    pendingMessage = {
      expected,
      resolve,
      timer: setTimeout(() => {
        pendingMessage = null;
        reject(new Error(`Timed out waiting for "${expected}"`));
      }, timeoutMs),
    };
  });
}

async function cleanup() {
  if (pendingMessage) {
    clearTimeout(pendingMessage.timer);
    pendingMessage = null;
  }

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

    await subscriber.subscribe(channel, onMessage);

    let received = waitForMessage("before-reconnect");
    await publisher.publish(channel, "before-reconnect");
    await received;
    console.log("PASS: Initial Pub/Sub delivery");

    await subscriber.unsubscribe(channel);
    await subscriber.disconnect();
    console.log("Subscriber disconnected");

    await subscriber.connect();
    await subscriber.subscribe(channel, onMessage);
    console.log("Subscriber reconnected and re-subscribed");

    received = waitForMessage("after-reconnect");
    await publisher.publish(channel, "after-reconnect");
    await received;
    console.log("PASS: Message received after reconnection");
  } catch (error) {
    console.error("FAIL:", error.message);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

runTest();
