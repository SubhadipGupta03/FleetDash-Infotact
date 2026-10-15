
const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing from the .env file");
  }

  client = new MongoClient(uri);
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
