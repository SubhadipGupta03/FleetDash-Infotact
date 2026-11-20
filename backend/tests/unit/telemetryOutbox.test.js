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
  ensureTelemetryOutboxIndexes,
  flushPendingTelemetry,
  startTelemetryOutbox,
  stopTelemetryOutbox,
} = require("../../services/telemetryOutbox");

describe("Telemetry Outbox", () => {
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

  test("should create all required outbox indexes", async () => {
  await ensureTelemetryOutboxIndexes();

  expect(collection.createIndex).toHaveBeenCalledTimes(3);

  expect(collection.createIndex).toHaveBeenCalledWith(
    { deliveryStatus: 1, createdAt: 1, _id: 1 },
    { name: "telemetry_outbox_pending" }
  );

  expect(collection.createIndex).toHaveBeenCalledWith(
    { deliveryStatus: 1, nextAttemptAt: 1, createdAt: 1 },
    { name: "telemetry_outbox_retry" }
  );

  expect(collection.createIndex).toHaveBeenCalledWith(
    { deliveryStatus: 1, leaseUntil: 1, createdAt: 1 },
    { name: "telemetry_outbox_lease" }
  );
});

test("should publish pending telemetry and mark it as published", async () => {
  const event = {
    _id: "OUTBOX-001",
    eventId: "OUTBOX-001",
    claimToken: "claim-token-001",
    attempts: 1,
    telemetry: {
      eventId: "OUTBOX-001",
      vehicleId: "TEST-VEHICLE-001",
      latitude: 28.6139,
      longitude: 77.209,
      timestamp: "2026-11-19T10:00:00.000Z",
    },
  };

  collection.findOneAndUpdate.mockResolvedValueOnce(event);
  collection.findOneAndUpdate.mockResolvedValueOnce(null);

  publisher.publish.mockResolvedValue(1);

  await flushPendingTelemetry();

  expect(publisher.publish).toHaveBeenCalledWith(
    "fleetdash:telemetry",
    JSON.stringify(event.telemetry)
  );

  expect(collection.updateOne).toHaveBeenCalledWith(
    {
      _id: event._id,
      deliveryStatus: "PROCESSING",
      claimToken: event.claimToken,
    },
    expect.objectContaining({
      $set: expect.objectContaining({
        deliveryStatus: "PUBLISHED",
      }),
    })
  );
});

test("should schedule a retry when Redis publishing fails", async () => {
  const event = {
    _id: "OUTBOX-002",
    eventId: "OUTBOX-002",
    claimToken: "claim-token-002",
    attempts: 1,
    telemetry: {
      eventId: "OUTBOX-002",
      vehicleId: "TEST-VEHICLE-002",
      latitude: 28.6139,
      longitude: 77.209,
      timestamp: "2026-11-19T10:00:00.000Z",
    },
  };

  collection.findOneAndUpdate
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(null);

  publisher.publish.mockRejectedValueOnce(
    new Error("Simulated Redis failure")
  );

  await flushPendingTelemetry();

  expect(collection.updateOne).toHaveBeenCalledWith(
    {
      _id: event._id,
      deliveryStatus: "PROCESSING",
      claimToken: event.claimToken,
    },
    expect.objectContaining({
      $set: expect.objectContaining({
        deliveryStatus: "PENDING",
        lastError: "Simulated Redis failure",
      }),
    })
  );
});

test("should reclaim a PROCESSING event after its lease expires", async () => {
  const expiredEvent = {
    _id: "OUTBOX-003",
    eventId: "OUTBOX-003",
    claimToken: "new-claim-token",
    attempts: 2,
    telemetry: {
      eventId: "OUTBOX-003",
      vehicleId: "TEST-VEHICLE-003",
      latitude: 28.6139,
      longitude: 77.209,
      timestamp: "2026-11-19T10:00:00.000Z",
    },
  };

  collection.findOneAndUpdate
    .mockResolvedValueOnce(expiredEvent)
    .mockResolvedValueOnce(null);

  publisher.publish.mockResolvedValue(1);

  await flushPendingTelemetry();

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
  test("should stop flushing when no pending telemetry exists", async () => {
    collection.findOneAndUpdate.mockResolvedValueOnce(null);

    await flushPendingTelemetry();

    expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

test("should stop flushing when claiming telemetry fails", async () => {
  collection.findOneAndUpdate.mockRejectedValueOnce(
    new Error("Simulated database claim failure")
  );

  await flushPendingTelemetry();

  expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  expect(publisher.publish).not.toHaveBeenCalled();
  expect(collection.updateOne).not.toHaveBeenCalled();
});

test("should warn when the publish claim is lost", async () => {
  const event = {
    _id: "OUTBOX-004",
    eventId: "OUTBOX-004",
    claimToken: "claim-token-004",
    attempts: 1,
    telemetry: {
      eventId: "OUTBOX-004",
      vehicleId: "TEST-VEHICLE-004",
      latitude: 28.6139,
      longitude: 77.209,
      timestamp: "2026-11-19T10:00:00.000Z",
    },
  };

  collection.findOneAndUpdate
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(null);
  collection.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
  publisher.publish.mockResolvedValueOnce(1);

  const warningSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

  try {
    await flushPendingTelemetry();

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(warningSpy).toHaveBeenCalledWith(
      "Telemetry outbox claim was lost for event OUTBOX-004"
    );
  } finally {
    warningSpy.mockRestore();
  }
});

test("should handle retry scheduling failure without crashing", async () => {
  const event = {
    _id: "OUTBOX-005",
    eventId: "OUTBOX-005",
    claimToken: "claim-token-005",
    attempts: 1,
    telemetry: {
      eventId: "OUTBOX-005",
      vehicleId: "TEST-VEHICLE-005",
      latitude: 28.6139,
      longitude: 77.209,
      timestamp: "2026-11-19T10:00:00.000Z",
    },
  };

  collection.findOneAndUpdate
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(null);

  publisher.publish.mockRejectedValueOnce(
    new Error("Simulated Redis failure")
  );
  collection.updateOne.mockRejectedValueOnce(
    new Error("Simulated retry database failure")
  );

  await expect(flushPendingTelemetry()).resolves.toBeUndefined();

  expect(publisher.publish).toHaveBeenCalledTimes(1);
  expect(collection.updateOne).toHaveBeenCalledTimes(1);
});

test("should share the active flush for concurrent calls", async () => {
  let releaseClaim;

  collection.findOneAndUpdate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseClaim = () => resolve(null);
      })
  );

  const firstFlush = flushPendingTelemetry();

  try {
    const secondFlush = flushPendingTelemetry();

    expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(1);

    releaseClaim();

    await Promise.all([firstFlush, secondFlush]);
  } finally {
    if (releaseClaim) releaseClaim();
    await stopTelemetryOutbox();
  }
});
test("should start and stop the outbox timer safely", async () => {
  jest.useFakeTimers();

  try {
    collection.findOneAndUpdate.mockResolvedValue(null);

    startTelemetryOutbox();
    startTelemetryOutbox();

    expect(jest.getTimerCount()).toBe(1);

    await stopTelemetryOutbox();

    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await stopTelemetryOutbox();
    jest.useRealTimers();
  }
});
test("should log errors when initial and scheduled flushes fail", async () => {
  jest.useFakeTimers();

  const errorSpy = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  getDatabase.mockImplementation(() => {
    throw new Error("Simulated database failure");
  });

  try {
    startTelemetryOutbox();

    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(2000);

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "Telemetry outbox flush failed:",
      "Simulated database failure"
    );
  } finally {
    await stopTelemetryOutbox();
    errorSpy.mockRestore();
    jest.useRealTimers();
  }
});
test("should use default retry attempts and fallback error text", async () => {
  const event = {
    _id: "OUTBOX-006",
    eventId: "OUTBOX-006",
    claimToken: "claim-token-006",
    attempts: 0,
    telemetry: { vehicleId: "TEST-VEHICLE-006" },
  };

  collection.findOneAndUpdate
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(null);

  publisher.publish.mockRejectedValueOnce("Redis unavailable");

  await flushPendingTelemetry();

  const retryUpdate = collection.updateOne.mock.calls[0][1];

  expect(retryUpdate.$set.deliveryStatus).toBe("PENDING");
  expect(retryUpdate.$set.lastError).toBe("Redis unavailable");
  expect(retryUpdate.$set.nextAttemptAt).toBeInstanceOf(Date);
});

test("should cap retry backoff and truncate long error messages", async () => {
  const event = {
    _id: "OUTBOX-007",
    eventId: "OUTBOX-007",
    claimToken: "claim-token-007",
    attempts: 100,
    telemetry: { vehicleId: "TEST-VEHICLE-007" },
  };

  collection.findOneAndUpdate
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(null);

  publisher.publish.mockRejectedValueOnce(
    new Error("X".repeat(1200))
  );

  const before = Date.now();

  await flushPendingTelemetry();

  const after = Date.now();
  const retryUpdate = collection.updateOne.mock.calls[0][1];

  expect(retryUpdate.$set.lastError).toHaveLength(1000);
  expect(retryUpdate.$set.nextAttemptAt.getTime() - before)
    .toBeGreaterThanOrEqual(60000);
  expect(retryUpdate.$set.nextAttemptAt.getTime() - after)
    .toBeLessThanOrEqual(60000);
});
test("should unref the retry timer when supported", async () => {
  const fakeTimer = { unref: jest.fn() };

  const intervalSpy = jest
    .spyOn(global, "setInterval")
    .mockReturnValue(fakeTimer);

  const clearSpy = jest
    .spyOn(global, "clearInterval")
    .mockImplementation(() => {});

  try {
    startTelemetryOutbox();

    expect(fakeTimer.unref).toHaveBeenCalledTimes(1);

    await stopTelemetryOutbox();
  } finally {
    await stopTelemetryOutbox();
    intervalSpy.mockRestore();
    clearSpy.mockRestore();
  }
});
test("should handle timers without unref support", async () => {
  const fakeTimer = {};

  const intervalSpy = jest
    .spyOn(global, "setInterval")
    .mockReturnValue(fakeTimer);

  const clearSpy = jest
    .spyOn(global, "clearInterval")
    .mockImplementation(() => {});

  try {
    startTelemetryOutbox();
    await stopTelemetryOutbox();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledWith(fakeTimer);
  } finally {
    await stopTelemetryOutbox();
    intervalSpy.mockRestore();
    clearSpy.mockRestore();
  }
});

  afterEach(async () => {
    await stopTelemetryOutbox();
  });
});