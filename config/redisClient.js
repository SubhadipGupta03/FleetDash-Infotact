const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL is missing from the environment');
}

const publisher = createClient({ url: redisUrl });

// A separate Redis connection is required for subscribing.
const subscriber = publisher.duplicate();

publisher.on('error', (err) => {
  console.error('Redis publisher error:', err.message);
});

subscriber.on('error', (err) => {
  console.error('Redis subscriber error:', err.message);
});

async function connectRedis() {
  if (!publisher.isOpen) {
    await publisher.connect();
  }

  if (!subscriber.isOpen) {
    await subscriber.connect();
  }

  console.log('Redis Pub/Sub connections ready');
}

module.exports = {
  publisher,
  subscriber,
  connectRedis,
};