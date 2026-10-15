
require("dotenv").config();

const express = require("express");
const telemetryRouter = require("./routes/telemetry");
const { connectDatabase } = require("./config/database");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "FleetDash backend is running",
  });
});

app.use("/api/telemetry", telemetryRouter);

async function startServer() {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`FleetDash server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start FleetDash:", error.message);
    process.exit(1);
  }
}

startServer();
