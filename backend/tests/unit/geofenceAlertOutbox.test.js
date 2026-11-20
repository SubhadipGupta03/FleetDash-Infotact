jest.mock("../../config/database", () => ({
  getDatabase: jest.fn(),
}));

jest.mock("../../config/redisClient", () => ({
  publisher: {
    publish: jest.fn(),
  },
}));

const { getDatabase } = require("../../config/database");
const { publisher } = require("../../config/redisClient");

const {
  ensureGeofenceAlertOutboxIndexes,
  flushPendingGeofenceAlerts,
  startGeofenceAlertOutbox,
  stopGeofenceAlertOutbox,
} = require("../../services/geofenceAlertOutbox");

describe("Geofence Alert Outbox", () => {
  let collection;

  beforeEach(() => {
    jest.clearAllMocks();

    collection = {
      createIndex: jest.fn().mockResolvedValue("index-created"),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({
        modifiedCount: 1,
      }),
    };

    getDatabase.mockReturnValue({
      collection: jest.fn().mockReturnValue(collection),
    });
  });

  test("should create all required geofence alert indexes", async () => {
    await ensureGeofenceAlertOutboxIndexes();

    expect(collection.createIndex).toHaveBeenCalledTimes(3);

    expect(collection.createIndex).toHaveBeenCalledWith(
      { deliveryStatus: 1, createdAt: 1 },
      { name: "geofence_alert_outbox_status_created" }
    );

    expect(collection.createIndex).toHaveBeenCalledWith(
      { deliveryStatus: 1, nextAttemptAt: 1, createdAt: 1 },
      { name: "geofence_alert_outbox_retry" }
    );

    expect(collection.createIndex).toHaveBeenCalledWith(
      { deliveryStatus: 1, leaseUntil: 1, createdAt: 1 },
      { name: "geofence_alert_outbox_lease" }
    );
  });
    test("should publish pending geofence alerts and mark them as published", async () => {
    const alert = {
      _id: "GEOFENCE-001",
      eventId: "GEOFENCE-001",
      vehicleId: "TEST-VEHICLE-001",
      alertType: "GEOFENCE_EXIT",
      claimToken: "claim-token-001",
      attempts: 1,
      claimedAt: new Date(),
      leaseUntil: new Date(),
      nextAttemptAt: new Date(),
      lastError: "previous error",
      createdAt: new Date(),
    };

    collection.findOneAndUpdate
      .mockResolvedValueOnce(alert)
      .mockResolvedValueOnce(null);

    publisher.publish.mockResolvedValue(1);

    const publishedCount = await flushPendingGeofenceAlerts();

    expect(publishedCount).toBe(1);

    const publishedPayload = JSON.parse(
      publisher.publish.mock.calls[0][1]
    );

    expect(publisher.publish).toHaveBeenCalledWith(
      "fleetdash:geofence-alerts",
      expect.any(String)
    );

    expect(publishedPayload).not.toHaveProperty("claimToken");
    expect(publishedPayload).not.toHaveProperty("claimedAt");
    expect(publishedPayload).not.toHaveProperty("leaseUntil");
    expect(publishedPayload).not.toHaveProperty("nextAttemptAt");
    expect(publishedPayload).not.toHaveProperty("attempts");
    expect(publishedPayload).not.toHaveProperty("lastError");

    expect(collection.updateOne).toHaveBeenCalledWith(
      {
        _id: alert._id,
        deliveryStatus: "PROCESSING",
        claimToken: alert.claimToken,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          deliveryStatus: "PUBLISHED",
        }),
        $unset: expect.any(Object),
      })
    );
  });
    test("should schedule a retry when Redis publishing fails", async () => {
    const alert = {
      _id: "GEOFENCE-002",
      claimToken: "claim-token-002",
      attempts: 1,
    };

    collection.findOneAndUpdate
      .mockResolvedValueOnce(alert)
      .mockResolvedValueOnce(null);

    publisher.publish.mockRejectedValueOnce(
      new Error("Simulated Redis failure")
    );

    const publishedCount = await flushPendingGeofenceAlerts();

    expect(publishedCount).toBe(0);

    expect(collection.updateOne).toHaveBeenCalledWith(
      {
        _id: alert._id,
        deliveryStatus: "PROCESSING",
        claimToken: alert.claimToken,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          deliveryStatus: "PENDING",
          lastError: "Simulated Redis failure",
          nextAttemptAt: expect.any(Date),
        }),
        $unset: expect.any(Object),
      })
    );

    const retryUpdate = collection.updateOne.mock.calls[0][1];
    const retryTime = retryUpdate.$set.nextAttemptAt;

    expect(retryTime.getTime()).toBeGreaterThan(Date.now());
  });
    test("should reclaim an alert after its processing lease expires", async () => {
    const expiredAlert = {
      _id: "GEOFENCE-003",
      claimToken: "new-claim-token",
      attempts: 2,
    };

    collection.findOneAndUpdate
      .mockResolvedValueOnce(expiredAlert)
      .mockResolvedValueOnce(null);

    publisher.publish.mockResolvedValue(1);

    await flushPendingGeofenceAlerts();

    const claimQuery = collection.findOneAndUpdate.mock.calls[0][0];

    expect(claimQuery.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deliveryStatus: "PROCESSING",
          leaseUntil: expect.objectContaining({
            $lte: expect.any(Date),
          }),
        }),
      ])
    );

    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
    test("should prevent concurrent flushes from running simultaneously", async () => {
    let resolvePublish;

    publisher.publish.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePublish = resolve;
        })
    );

    collection.findOneAndUpdate
      .mockResolvedValueOnce({
        _id: "GEOFENCE-004",
        claimToken: "claim-token-004",
        attempts: 1,
      })
      .mockResolvedValueOnce(null);

    const firstFlush = flushPendingGeofenceAlerts();

    await new Promise((resolve) => setImmediate(resolve));

    const secondFlush = flushPendingGeofenceAlerts();

    expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);

    resolvePublish(1);

    const results = await Promise.all([firstFlush, secondFlush]);

    expect(results).toEqual([1, 1]);
    expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
    test("should not count an alert when its publish claim has been lost", async () => {
    const alert = {
      _id: "GEOFENCE-005",
      claimToken: "claim-token-005",
      attempts: 1,
    };

    collection.findOneAndUpdate
      .mockResolvedValueOnce(alert)
      .mockResolvedValueOnce(null);

    collection.updateOne.mockResolvedValueOnce({
      modifiedCount: 0,
    });

    publisher.publish.mockResolvedValue(1);

    const publishedCount = await flushPendingGeofenceAlerts();

    expect(publishedCount).toBe(0);

    expect(collection.updateOne).toHaveBeenCalledWith(
      {
        _id: alert._id,
        deliveryStatus: "PROCESSING",
        claimToken: alert.claimToken,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          deliveryStatus: "PUBLISHED",
        }),
      })
    );
  });
    test("should handle failure to schedule a retry", async () => {
    const alert = {
      _id: "GEOFENCE-006",
      claimToken: "claim-token-006",
      attempts: 1,
    };

    collection.findOneAndUpdate
      .mockResolvedValueOnce(alert)
      .mockResolvedValueOnce(null);

    publisher.publish.mockRejectedValueOnce(
      new Error("Simulated Redis failure")
    );

    collection.updateOne.mockRejectedValueOnce(
      new Error("Simulated MongoDB retry failure")
    );

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const publishedCount = await flushPendingGeofenceAlerts();

      expect(publishedCount).toBe(0);
      expect(collection.updateOne).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to schedule geofence alert retry"),
        "Simulated MongoDB retry failure"
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
    test("should log an initial flush failure", async () => {
    getDatabase.mockImplementation(() => {
      throw new Error("Simulated initial database failure");
    });

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      jest.useFakeTimers();

      startGeofenceAlertOutbox(5000);

      await Promise.resolve();
      await Promise.resolve();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Initial geofence outbox flush failed:",
        "Simulated initial database failure"
      );
    } finally {
      await stopGeofenceAlertOutbox();
      jest.useRealTimers();
      consoleErrorSpy.mockRestore();
    }
  });

  test("should log a scheduled flush failure", async () => {
    getDatabase.mockImplementation(() => {
      throw new Error("Simulated scheduled database failure");
    });

    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      jest.useFakeTimers();

      startGeofenceAlertOutbox(5000);

      await Promise.resolve();
      await Promise.resolve();

      consoleErrorSpy.mockClear();

      jest.advanceTimersByTime(5000);

      await Promise.resolve();
      await Promise.resolve();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Geofence outbox retry failed:",
        "Simulated scheduled database failure"
      );
    } finally {
      await stopGeofenceAlertOutbox();
      jest.useRealTimers();
      consoleErrorSpy.mockRestore();
    }
  });
    test("should start only one retry timer when called multiple times", async () => {
    jest.useFakeTimers();

    try {
      startGeofenceAlertOutbox(5000);
      startGeofenceAlertOutbox(5000);

      expect(jest.getTimerCount()).toBe(1);
    } finally {
      await stopGeofenceAlertOutbox();
      jest.useRealTimers();
    }
  });
  afterEach(async () => {
    await stopGeofenceAlertOutbox();
  });
});