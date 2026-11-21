jest.mock("../../config/redisClient", () => ({
  publisher: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock("../../config/database", () => ({
  getDatabase: jest.fn(),
}));

jest.mock("../../services/geofenceAlertOutbox", () => ({
  flushPendingGeofenceAlerts: jest.fn(),
}));
jest.mock("../../config/geofenceWorkerPool", () => ({
  processGeofenceTask: jest.fn(async (data) => {
    const {
      checkGeofence,
      hasBoundaryIntersection,
    } = require("../../services/geofenceService");

    if (data.operation === "calculate-geofences") {
      return {
        result: checkGeofence(
          data.currentPosition.latitude,
          data.currentPosition.longitude
        ),
      };
    }

    if (data.operation === "check-boundary") {
      return {
        result: hasBoundaryIntersection(
          data.previousPosition,
          data.currentPosition,
          data.geofence
        ),
      };
    }

    throw new Error("Unknown geofence worker operation");
  }),
}));

const { publisher } = require("../../config/redisClient");
const { getDatabase } = require("../../config/database");
const {
  flushPendingGeofenceAlerts,
} = require("../../services/geofenceAlertOutbox");

const {
  processGeofenceAlerts,
} = require("../../services/geofenceAlertService");

describe("Geofence Alert Service", () => {
  let collection;
    test("should reject telemetry without a valid vehicleId", async () => {
    await expect(
      processGeofenceAlerts({
        latitude: 28.6140,
        longitude: 77.2100,
        timestamp: new Date().toISOString(),
        eventId: "EVENT-001",
      })
    ).rejects.toThrow("vehicleId is required");

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(publisher.set).not.toHaveBeenCalled();
  });
    test("should reject telemetry with invalid coordinates", async () => {
    await expect(
      processGeofenceAlerts({
        vehicleId: "VH-INVALID-001",
        latitude: 120,
        longitude: 77.2100,
        timestamp: new Date().toISOString(),
        eventId: "EVENT-002",
      })
    ).rejects.toThrow(
      "Invalid telemetry supplied to geofence processing"
    );

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(publisher.set).not.toHaveBeenCalled();
  });
    test("should reject telemetry without an eventId", async () => {
    await expect(
      processGeofenceAlerts({
        vehicleId: "VH-INVALID-002",
        latitude: 28.6140,
        longitude: 77.2100,
        timestamp: new Date().toISOString(),
      })
    ).rejects.toThrow("eventId is required");

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(publisher.set).not.toHaveBeenCalled();
  });
    test("should update Redis state for a vehicle inside the geofence", async () => {
    const telemetry = {
      vehicleId: "VH-INSIDE-001",
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:00:00.000Z",
      eventId: "EVENT-003",
    };

    const alerts = await processGeofenceAlerts(telemetry);

    expect(alerts).toHaveLength(0);
    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(flushPendingGeofenceAlerts).not.toHaveBeenCalled();

    expect(publisher.set).toHaveBeenCalledWith(
      "fleetdash:geofence-state:VH-INSIDE-001:DURGAPUR-DEMO-ZONE",
      "INSIDE"
    );

    expect(publisher.set).toHaveBeenCalledWith(
      "fleetdash:geofence-state:VH-INSIDE-001:DURGAPUR-DEMO-ZONE:position",
      JSON.stringify({
        latitude: telemetry.latitude,
        longitude: telemetry.longitude,
        timestamp: telemetry.timestamp,
      })
    );
  });
    test("should create and flush an alert when a vehicle exits the geofence", async () => {
    const previousPosition = {
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:00:00.000Z",
    };

    publisher.get
      .mockResolvedValueOnce("INSIDE")
      .mockResolvedValueOnce(JSON.stringify(previousPosition));

    const telemetry = {
      vehicleId: "VH-BREACH-001",
      latitude: 28.6200,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:01:00.000Z",
      eventId: "EVENT-004",
    };

    const alerts = await processGeofenceAlerts(telemetry);

    expect(alerts).toHaveLength(1);
    expect(collection.insertOne).toHaveBeenCalledTimes(1);

    const insertedAlert = collection.insertOne.mock.calls[0][0];

    expect(insertedAlert).toEqual(
      expect.objectContaining({
        _id: "EVENT-004:DURGAPUR-DEMO-ZONE",
        eventId: "EVENT-004",
        vehicleId: "VH-BREACH-001",
        geofenceId: "DURGAPUR-DEMO-ZONE",
        type: "GEOFENCE_BREACH",
        deliveryStatus: "PENDING",
      })
    );

    expect(flushPendingGeofenceAlerts).toHaveBeenCalledTimes(1);
    expect(publisher.set).toHaveBeenCalledTimes(2);
  });
  test("should handle duplicate alert insertion without failing", async () => {
    const previousPosition = {
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:00:00.000Z",
    };

    publisher.get
      .mockResolvedValueOnce("INSIDE")
      .mockResolvedValueOnce(JSON.stringify(previousPosition));

    collection.insertOne.mockRejectedValueOnce(
      Object.assign(new Error("Duplicate key"), { code: 11000 })
    );

    const alerts = await processGeofenceAlerts({
      vehicleId: "VH-DUPLICATE-001",
      latitude: 28.6200,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:01:00.000Z",
      eventId: "EVENT-005",
    });

    expect(alerts).toHaveLength(0);
    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(flushPendingGeofenceAlerts).not.toHaveBeenCalled();

    expect(publisher.set).toHaveBeenCalledTimes(2);
  });
    test("should ignore telemetry older than the stored GPS position", async () => {
    const previousPosition = {
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:10:00.000Z",
    };

    publisher.get
      .mockResolvedValueOnce("INSIDE")
      .mockResolvedValueOnce(JSON.stringify(previousPosition));

    const alerts = await processGeofenceAlerts({
      vehicleId: "VH-OLDER-001",
      latitude: 28.6200,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:05:00.000Z",
      eventId: "EVENT-006",
    });

    expect(alerts).toHaveLength(0);
    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(publisher.set).not.toHaveBeenCalled();
    expect(flushPendingGeofenceAlerts).not.toHaveBeenCalled();
  });
    test("should process different vehicles independently", async () => {
    let releaseFirst;

    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    publisher.get.mockImplementation(async (key) => {
      if (key.includes("VH-QUEUE-A")) {
        await firstGate;
      }

      return null;
    });

    const firstTask = processGeofenceAlerts({
      vehicleId: "VH-QUEUE-A",
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:00:00.000Z",
      eventId: "EVENT-007",
    });

    const secondTask = processGeofenceAlerts({
      vehicleId: "VH-QUEUE-B",
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:00:00.000Z",
      eventId: "EVENT-008",
    });

    const secondResult = await Promise.race([
      secondTask.then(() => "completed"),
      new Promise((resolve) => setImmediate(() => resolve("blocked"))),
    ]);

    releaseFirst();

    await firstTask;
    await secondTask;

    expect(secondResult).toBe("completed");
  });
    test("should process events for the same vehicle sequentially", async () => {
    let releaseFirst;
    let firstStarted = false;
    let secondStarted = false;

    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    publisher.get.mockImplementation(async (key) => {
      if (key.includes("VH-QUEUE-SAME")) {
        const callCount = publisher.get.mock.calls.filter(
          ([calledKey]) => calledKey.includes("VH-QUEUE-SAME")
        ).length;

        if (callCount <= 2) {
          firstStarted = true;
          await firstGate;
        } else {
          secondStarted = true;
        }
      }

      return null;
    });

    const firstTask = processGeofenceAlerts({
      vehicleId: "VH-QUEUE-SAME",
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:00:00.000Z",
      eventId: "EVENT-009",
    });

    const secondTask = processGeofenceAlerts({
      vehicleId: "VH-QUEUE-SAME",
      latitude: 28.6150,
      longitude: 77.2110,
      timestamp: "2026-11-20T05:01:00.000Z",
      eventId: "EVENT-010",
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(firstStarted).toBe(true);
    expect(secondStarted).toBe(false);

    releaseFirst();

    await Promise.all([firstTask, secondTask]);

    expect(secondStarted).toBe(true);
  });
    test("should propagate MongoDB errors other than duplicate-key errors", async () => {
    publisher.get
      .mockResolvedValueOnce("INSIDE")
      .mockResolvedValueOnce(
        JSON.stringify({
          latitude: 28.6140,
          longitude: 77.2100,
          timestamp: "2026-11-20T05:00:00.000Z",
        })
      );

    collection.insertOne.mockRejectedValueOnce(
      Object.assign(new Error("MongoDB unavailable"), { code: 12345 })
    );

    await expect(
      processGeofenceAlerts({
        vehicleId: "VH-DB-ERROR",
        latitude: 28.6200,
        longitude: 77.2100,
        timestamp: "2026-11-20T05:01:00.000Z",
        eventId: "EVENT-011",
      })
    ).rejects.toThrow("MongoDB unavailable");

    expect(publisher.set).not.toHaveBeenCalled();
    expect(flushPendingGeofenceAlerts).not.toHaveBeenCalled();
  });
    test("should ignore an invalid previous Redis position", async () => {
    publisher.get
      .mockResolvedValueOnce("INSIDE")
      .mockResolvedValueOnce(
        JSON.stringify({
          latitude: 120,
          longitude: 77.2100,
          timestamp: "2026-11-20T05:00:00.000Z",
        })
      );

    const alerts = await processGeofenceAlerts({
      vehicleId: "VH-INVALID-PREVIOUS",
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:01:00.000Z",
      eventId: "EVENT-012",
    });

    expect(alerts).toHaveLength(0);
    expect(publisher.set).toHaveBeenCalledTimes(2);
    expect(collection.insertOne).not.toHaveBeenCalled();
  });
    test("should handle malformed JSON in the previous Redis position", async () => {
    publisher.get
      .mockResolvedValueOnce("INSIDE")
      .mockResolvedValueOnce("{invalid-json");

    const alerts = await processGeofenceAlerts({
      vehicleId: "VH-MALFORMED-001",
      latitude: 28.6140,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:01:00.000Z",
      eventId: "EVENT-013",
    });

    expect(alerts).toHaveLength(0);
    expect(publisher.set).toHaveBeenCalledTimes(2);
    expect(collection.insertOne).not.toHaveBeenCalled();
  });
    test("should reject telemetry with an invalid timestamp", async () => {
    await expect(
      processGeofenceAlerts({
        vehicleId: "VH-INVALID-TIME",
        latitude: 28.6140,
        longitude: 77.2100,
        timestamp: "not-a-valid-date",
        eventId: "EVENT-014",
      })
    ).rejects.toThrow(
      "Invalid telemetry timestamp for geofence processing"
    );

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(publisher.set).not.toHaveBeenCalled();
  });
    test("should process telemetry when the previous Redis position has an invalid timestamp", async () => {
    publisher.get
      .mockResolvedValueOnce("INSIDE")
      .mockResolvedValueOnce(
        JSON.stringify({
          latitude: 28.6140,
          longitude: 77.2100,
          timestamp: "invalid-date",
        })
      );

    const alerts = await processGeofenceAlerts({
      vehicleId: "VH-INVALID-PREVIOUS-TIME",
      latitude: 28.6190,
      longitude: 77.2100,
      timestamp: "2026-11-20T05:05:00.000Z",
      eventId: "EVENT-015",
    });

    expect(alerts).toHaveLength(1);
    expect(collection.insertOne).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    jest.clearAllMocks();

    collection = {
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };

    getDatabase.mockReturnValue({
      collection: jest.fn().mockReturnValue(collection),
    });

    publisher.get.mockResolvedValue(null);
    publisher.set.mockResolvedValue("OK");
    flushPendingGeofenceAlerts.mockResolvedValue(0);
  });
});