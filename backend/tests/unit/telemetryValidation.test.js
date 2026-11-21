jest.mock("../../config/telemetryBuckets", () => ({
  storeTelemetry: jest.fn(),
}));

jest.mock("../../services/geofenceAlertService", () => ({
  processGeofenceAlerts: jest.fn(),
}));

jest.mock("../../config/database", () => ({
  getDatabase: jest.fn(),
}));

const express = require("express");
const request = require("supertest");

const { storeTelemetry } = require("../../config/telemetryBuckets");
const { processGeofenceAlerts } = require("../../services/geofenceAlertService");
const {
  closeTelemetryWorkerPool,
} = require("../../config/telemetryWorkerPool");

const router = require("../../routes/telemetry");

const app = express();
app.use(express.json());
app.use("/api/telemetry", router);

const validPayload = {
  eventId: "VALIDATION-TEST-001",
  vehicleId: "VALIDATION-VEHICLE-001",
  latitude: 28.6139,
  longitude: 77.209,
  timestamp: "2026-11-21T10:00:00.000Z",
};

describe("Telemetry HTTP input validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeTelemetry.mockResolvedValue({ duplicate: false });
    processGeofenceAlerts.mockResolvedValue([]);
  });
    test("recognizes a repeated event ID as a duplicate", async () => {
    storeTelemetry
      .mockResolvedValueOnce({ duplicate: false })
      .mockResolvedValueOnce({ duplicate: true });

    const firstResponse = await request(app)
      .post("/api/telemetry/ingest")
      .send(validPayload);

    const secondResponse = await request(app)
      .post("/api/telemetry/ingest")
      .send(validPayload);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.duplicate).toBe(false);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.duplicate).toBe(true);

    expect(storeTelemetry).toHaveBeenCalledTimes(2);
    expect(processGeofenceAlerts).toHaveBeenCalledTimes(1);
  });

  afterAll(async () => {
    await closeTelemetryWorkerPool();
  });

  test.each([
    ["latitude above 90", { latitude: 91 }],
    ["latitude below -90", { latitude: -91 }],
    ["longitude above 180", { longitude: 181 }],
    ["longitude below -180", { longitude: -181 }],
    ["non-numeric latitude", { latitude: "invalid" }],
    ["missing vehicleId", { vehicleId: undefined }],
    ["invalid timestamp", { timestamp: "not-a-date" }],
    ["non-numeric longitude", { longitude: "invalid" }],
    ["missing latitude", { latitude: undefined }],
    ["missing longitude", { longitude: undefined }],
    ["missing timestamp", { timestamp: undefined }],
  ])("rejects %s with HTTP 400", async (_description, changes) => {
    const payload = { ...validPayload, ...changes };

    const response = await request(app)
      .post("/api/telemetry/ingest")
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(storeTelemetry).not.toHaveBeenCalled();
  });
});
