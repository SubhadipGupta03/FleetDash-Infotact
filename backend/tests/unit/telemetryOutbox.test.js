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



  afterEach(async () => {
    await stopTelemetryOutbox();
  });
});