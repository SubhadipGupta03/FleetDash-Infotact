const { createCluster } = require("redis");

const configuredNodes = process.env.REDIS_NODES
  ?.split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const rootNodes = (
  configuredNodes?.length
    ? configuredNodes
    : [
        "redis://127.0.0.1:7001",
        "redis://127.0.0.1:7002",
        "redis://127.0.0.1:7003",
      ]
).map((url) => ({ url }));

const publisher = createCluster({ rootNodes });
const subscriber = createCluster({ rootNodes });

publisher.on("error", (error) => {
  console.error("Redis Cluster publisher error:", error.message);
});

subscriber.on("error", (error) => {
  console.error("Redis Cluster subscriber error:", error.message);
});

let connectPromise = null;

async function connectRedis() {
  if (publisher.isOpen && subscriber.isOpen) {
    return;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    try {
      if (!publisher.isOpen) {
        await publisher.connect();
      }

      if (!subscriber.isOpen) {
        await subscriber.connect();
      }

      console.log("Redis Cluster Pub/Sub connections ready");
    } catch (error) {
      // Avoid leaving a half-connected pair after startup fails.
      await Promise.all(
        [
          ["publisher", publisher],
          ["subscriber", subscriber],
        ].map(async ([name, client]) => {
          if (!client.isOpen) return;

          try {
            await client.quit();
          } catch (closeError) {
            console.error(
              `Failed to close Redis ${name}:`,
              closeError.message
            );

            try {
              client.destroy();
            } catch {
              // Preserve the original connection error.
            }
          }
        })
      );

      throw error;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

module.exports = {
  publisher,
  subscriber,
  connectRedis,
};