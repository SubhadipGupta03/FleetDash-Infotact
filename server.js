
const express = require("express");
const telemetryRouter = require("./routes/telemetry");
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

app.listen(PORT, () => {
  console.log(`FleetDash server running on port ${PORT}`);
});
