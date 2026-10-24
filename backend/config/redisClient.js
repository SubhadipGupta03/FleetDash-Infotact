
const { createCluster } = require("redis");

const rootNodes = [
  { url: "redis://127.0.0.1:7001" },
  { url: "redis://127.0.0.1:7002" },
  { url: "redis://127.0.0.1:7003" },
];

const publisher = createCluster({ rootNodes });
const subscriber = createCluster({ rootNodes });

publisher.on("error", (err) => {
  console.error("Redis Cluster publisher error:", err.message);
});

subscriber.on("error", (err) => {
  console.error("Redis Cluster subscriber error:", err.message);
});

async function connectRedis() {
  if (!publisher.isOpen) {
    await publisher.connect();
  }

  if (!subscriber.isOpen) {
    await subscriber.connect();
  }

  console.log("Redis Cluster Pub/Sub connections ready");
}

module.exports = {
  publisher,
  subscriber,
  connectRedis,
};
