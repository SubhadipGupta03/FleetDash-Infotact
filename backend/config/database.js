const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing from the .env file");
  }

  client = new MongoClient(uri, {
    maxPoolSize: Number.parseInt(process.env.MONGODB_MAX_POOL_SIZE || "50", 10),
    minPoolSize: Number.parseInt(process.env.MONGODB_MIN_POOL_SIZE || "5", 10),
    maxConnecting: 5,
    waitQueueTimeoutMS: 5000,
    serverSelectionTimeoutMS: 10000,
  });

  await client.connect();

  db = client.db("fleetdash");

  console.log("MongoDB Atlas connected successfully");

  return db;
}

function getDatabase() {
  if (!db) {
    throw new Error("Database is not connected yet");
  }

  return db;
}

async function closeDatabase() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

module.exports = {
  connectDatabase,
  getDatabase,
  closeDatabase,
};
