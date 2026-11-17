
const { createCluster, createClient } = require("redis");

const redisMode = (process.env.REDIS_MODE || "cluster").toLowerCase();

let publisher;
let subscriber;

if (redisMode === "upstash") {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required when REDIS_MODE=upstash");
  }

  publisher = createClient({ url: redisUrl });
  subscriber = publisher.duplicate();

  publisher.on("error", (error) => {
    console.error("Upstash Redis publisher error:", error.message);
  });

  subscriber.on("error", (error) => {
    console.error("Upstash Redis subscriber error:", error.message);
  });
} else if (redisMode === "cluster") {
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

  publisher = createCluster({ rootNodes });
  subscriber = createCluster({ rootNodes });

  publisher.on("error", (error) => {
    console.error("Redis Cluster publisher error:", error.message);
  });

  subscriber.on("error", (error) => {
    console.error("Redis Cluster subscriber error:", error.message);
  });
} else {
  throw new Error(
    `Invalid REDIS_MODE: ${redisMode}. Use "cluster" or "upstash".`
  );
}

let connectPromise = null;

async function connectRedis() {
  if (publisher.isReady && subscriber.isReady) {
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

      console.log(
        redisMode === "upstash"
          ? "Upstash Redis Pub/Sub connections ready"
          : "Redis Cluster Pub/Sub connections ready"
      );
    } catch (error) {
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
