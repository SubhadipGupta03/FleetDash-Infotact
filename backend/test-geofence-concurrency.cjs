const { io } = require("socket.io-client");

const URL = "http://localhost:5000";
const vehicleId = `VH-GEOFENCE-CONCURRENCY-${Date.now()}`;

const clients = [
  io(URL, { transports: ["websocket"] }),
  io(URL, { transports: ["websocket"] }),
];

const receivedAlerts = [];

function waitForConnection(socket, index) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Client ${index + 1} connection timeout`));
    }, 10000);

    socket.once("connection-status", (data) => {
      clearTimeout(timer);
      console.log(`Client ${index + 1} connected:`, data.message);
      resolve();
    });

    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function sendTelemetry(eventId, latitude) {
  const response = await fetch(`${URL}/api/telemetry/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId,
      vehicleId,
      latitude,
      longitude: 77.2090,
      timestamp: new Date().toISOString(),
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(`${eventId}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  try {
    await Promise.all(clients.map(waitForConnection));

    clients.forEach((socket, index) => {
      socket.on("geofence-alert", (alert) => {
        receivedAlerts.push({
          client: index + 1,
          eventId: alert.eventId,
          vehicleId: alert.vehicleId,
          type: alert.type,
        });

        console.log(
          `Client ${index + 1} received breach:`,
          alert.eventId
        );
      });
    });

    const insideEventId = `GEOFENCE-INSIDE-${Date.now()}`;

    await sendTelemetry(insideEventId, 28.6140);
    console.log("Vehicle entered the geofence.");

    const outsideEvents = Array.from({ length: 3 }, (_, index) => ({
      eventId: `${vehicleId}-OUTSIDE-${index + 1}`,
      latitude: 28.6200,
    }));

    console.log("Sending 3 outside events simultaneously...");

    const results = await Promise.all(
      outsideEvents.map((event) =>
        sendTelemetry(event.eventId, event.latitude)
      )
    );

    const apiAlerts = results.flatMap(
      (result) => result.geofenceAlerts || []
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const uniqueSocketAlerts = new Set(
      receivedAlerts.map((alert) => alert.eventId)
    );

    console.log("\n--- GEOFENCE CONCURRENCY RESULTS ---");
    console.log("Outside events sent:", outsideEvents.length);
    console.log("API breach alerts:", apiAlerts.length);
    console.log("Unique Socket.IO breach alerts:", uniqueSocketAlerts.size);
    console.log("Total Socket.IO deliveries:", receivedAlerts.length);

    if (apiAlerts.length === 1 && uniqueSocketAlerts.size === 1) {
      console.log("\nPASS: One breach alert was generated.");
    } else {
      console.log("\nRACE DETECTED: Check the alert counts above.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Concurrency test failed:", error.message);
    process.exitCode = 1;
  } finally {
    clients.forEach((socket) => socket.disconnect());
  }
}

main();