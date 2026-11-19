jest.mock("../../config/database", () => ({
  getDatabase: jest.fn(),
}));

jest.mock("../../config/telemetryWorkerPool", () => ({
  processTelemetry: jest.fn().mockResolvedValue({
    success: true,
    telemetry: {
      vehicleId: "TEST-VEHICLE-001",
      latitude: 28.6139,
      longitude: 77.209,
      timestamp: "2026-11-17T06:00:00.000Z",
    },
  }),
  closeTelemetryWorkerPool: jest.fn(),
}));

jest.mock("../../config/telemetryBuckets", () => ({
  storeTelemetry: jest.fn().mockResolvedValue({
    duplicate: false,
  }),
  ensureTelemetryIndexes: jest.fn(),
}));

jest.mock("../../config/redisClient", () => ({
  publisher: {
    publish: jest.fn().mockResolvedValue(1),
    on: jest.fn(),
  },
  subscriber: {
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    isOpen: false,
  },
  connectRedis: jest.fn(),
}));

jest.mock("../../services/geofenceAlertService", () => ({
  processGeofenceAlerts: jest.fn().mockResolvedValue([]),
}));

const request = require("supertest");
const { app } = require("../../server");

const {
  processTelemetry,
} = require("../../config/telemetryWorkerPool");

const {
  storeTelemetry,
} = require("../../config/telemetryBuckets");

const { getDatabase } = require("../../config/database");

const {
  processGeofenceAlerts,
} = require("../../services/geofenceAlertService");

describe("FleetDash API tests", () => {
    const mockEvents = {
  estimatedDocumentCount: jest.fn(),
};

  const mockBuckets = {
    aggregate: jest.fn(),
    find: jest.fn(),
  };

  const mockAlerts = {
    find: jest.fn(),
  };

  const mockDatabase = {
    collection: jest.fn((name) => {
      if (name === "telemetryEvents") return mockEvents;
      if (name === "telemetryBuckets") return mockBuckets;
      if (name === "geofenceAlerts") return mockAlerts;

      throw new Error(`Unexpected collection: ${name}`);
    }),
  };
 beforeEach(() => {
  jest.clearAllMocks();

  getDatabase.mockReturnValue(mockDatabase);

  mockEvents.estimatedDocumentCount.mockResolvedValue(83);

  mockBuckets.aggregate.mockReturnValue({
    toArray: jest.fn().mockResolvedValue([
      {
        vehicleId: "VH-K6-DISTRIBUTED-34",
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: "2026-11-17T06:00:00.000Z",
        telemetryCount: 14,
      },
    ]),
  });

  mockAlerts.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            vehicleId: "VH-K6-DISTRIBUTED-34",
            timestamp: "2026-11-17T06:00:00.000Z",
            type: "ENTER",
          },
        ]),
      }),
    }),
  });

  mockBuckets.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            vehicleId: "VH-K6-DISTRIBUTED-34",
            readings: [],
          },
        ]),
      }),
    }),
  });
});

      test("GET / should return backend running status", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "FleetDash backend is running",
    });
  });

  test("GET /api/telemetry/history should return historical fleet data", async () => {
    const response = await request(app).get("/api/telemetry/history");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      totalVehicles: 1,
      totalTelemetryEvents: 83,
    });

    expect(response.body.vehicles).toHaveLength(1);
    expect(response.body.vehicles[0].vehicleId).toBe(
      "VH-K6-DISTRIBUTED-34"
    );

    expect(response.body.geofenceAlerts).toHaveLength(1);
    expect(response.body.recentBuckets).toHaveLength(1);

    expect(getDatabase).toHaveBeenCalledTimes(1);
    expect(mockDatabase.collection).toHaveBeenCalledWith("telemetryEvents");
    expect(mockDatabase.collection).toHaveBeenCalledWith("telemetryBuckets");
    expect(mockDatabase.collection).toHaveBeenCalledWith("geofenceAlerts");
  });

  test("GET /api/telemetry/history should return 500 when database fails", async () => {
    getDatabase.mockImplementationOnce(() => {
      throw new Error("Simulated database failure");
    });

    const response = await request(app).get("/api/telemetry/history");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Failed to retrieve historical telemetry",
    });

    expect(getDatabase).toHaveBeenCalledTimes(1);
  });

  test("POST /api/telemetry/ingest should reject missing eventId", async () => {
    const response = await request(app)
      .post("/api/telemetry/ingest")
      .send({
        vehicleId: "TEST-VEHICLE-001",
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: "eventId or Idempotency-Key is required",
    });

    expect(processTelemetry).not.toHaveBeenCalled();
  });

  test("POST /api/telemetry/ingest should accept Idempotency-Key header", async () => {
    const response = await request(app)
      .post("/api/telemetry/ingest")
      .set("Idempotency-Key", "JEST-TEST-EVENT-001")
      .send({
        vehicleId: "TEST-VEHICLE-001",
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(processTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleId: "TEST-VEHICLE-001",
      })
    );
  });

  test("POST /api/telemetry/ingest should return 500 when MongoDB storage fails", async () => {
    storeTelemetry.mockRejectedValueOnce(
      new Error("Simulated MongoDB storage failure")
    );

    const response = await request(app)
      .post("/api/telemetry/ingest")
      .set("Idempotency-Key", "JEST-STORAGE-FAIL-001")
      .send({
        vehicleId: "TEST-VEHICLE-001",
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Failed to store telemetry",
    });

    expect(storeTelemetry).toHaveBeenCalledTimes(1);
  });

  test("POST /api/telemetry/ingest should queue telemetry for background delivery", async () => {
  const response = await request(app)
    .post("/api/telemetry/ingest")
    .set("Idempotency-Key", "JEST-OUTBOX-001")
    .send({
      vehicleId: "TEST-VEHICLE-001",
      latitude: 28.6139,
      longitude: 77.209,
      timestamp: new Date().toISOString(),
    });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    success: true,
    message: "Telemetry stored successfully; delivery queued through outbox",
    duplicate: false,
    telemetry: {
      eventId: "JEST-OUTBOX-001",
    },
  });

  expect(storeTelemetry).toHaveBeenCalledTimes(1);
});

  test("POST /api/telemetry/ingest should reject invalid telemetry from worker", async () => {
    processTelemetry.mockResolvedValueOnce({
      success: false,
      error: "Invalid telemetry payload",
    });

    const response = await request(app)
      .post("/api/telemetry/ingest")
      .set("Idempotency-Key", "JEST-WORKER-INVALID-001")
      .send({
        vehicleId: "TEST-VEHICLE-001",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: "Invalid telemetry payload",
    });

    expect(storeTelemetry).not.toHaveBeenCalled();
  });

  test("POST /api/telemetry/ingest should return 503 when worker queue is full", async () => {
    const error = new Error("Worker queue is full");
    error.code = "WORKER_QUEUE_FULL";

    processTelemetry.mockRejectedValueOnce(error);

    const response = await request(app)
      .post("/api/telemetry/ingest")
      .set("Idempotency-Key", "JEST-WORKER-QUEUE-001")
      .send({
        vehicleId: "TEST-VEHICLE-001",
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: "Telemetry processing queue is full",
    });

    expect(storeTelemetry).not.toHaveBeenCalled();
  });

  test("POST /api/telemetry/ingest should return 500 when worker fails unexpectedly", async () => {
    processTelemetry.mockRejectedValueOnce(
      new Error("Simulated worker failure")
    );

    const response = await request(app)
      .post("/api/telemetry/ingest")
      .set("Idempotency-Key", "JEST-WORKER-ERROR-001")
      .send({
        vehicleId: "TEST-VEHICLE-001",
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Telemetry processing failed",
    });

    expect(storeTelemetry).not.toHaveBeenCalled();
  });

  test("POST /api/telemetry/ingest should not broadcast duplicate events", async () => {
    storeTelemetry.mockResolvedValueOnce({
      duplicate: true,
    });

    const response = await request(app)
      .post("/api/telemetry/ingest")
      .set("Idempotency-Key", "JEST-DUPLICATE-EVENT-001")
      .send({
        vehicleId: "TEST-VEHICLE-001",
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.duplicate).toBe(true);
    expect(response.body.geofenceAlerts).toEqual([]);

    expect(storeTelemetry).toHaveBeenCalledTimes(1);
  });

  test("POST /api/telemetry/ingest should still queue telemetry when geofence processing fails", async () => {
    processGeofenceAlerts.mockRejectedValueOnce(
      new Error("Simulated geofence processing failure")
    );

    const response = await request(app)
      .post("/api/telemetry/ingest")
      .set("Idempotency-Key", "JEST-GEOFENCE-FAIL-001")
      .send({
        vehicleId: "TEST-VEHICLE-001",
        latitude: 28.6139,
        longitude: 77.209,
        timestamp: new Date().toISOString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.geofenceAlerts).toEqual([]);

    expect(processGeofenceAlerts).toHaveBeenCalledTimes(1);
    expect(storeTelemetry).toHaveBeenCalledTimes(1);
  });
});
