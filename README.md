# FleetDash-Infotact

FleetDash is a real-time fleet telemetry dashboard designed to ingest, store, and display vehicle telemetry using an event-driven backend and a React + TypeScript frontend.

## Project Structure

- `backend/` — Express API, worker-thread telemetry processing, MongoDB bucket storage, Redis Pub/Sub, and Socket.IO binary delivery.
- `frontend/` — React and TypeScript dashboard with live telemetry updates.

## Technology Stack

**Frontend**
- React
- TypeScript
- Vite
- Socket.IO Client

**Backend**
- Node.js
- Express
- Worker Threads
- MongoDB
- Redis Pub/Sub
- Socket.IO

## Development Progress

### Week 1
- Express backend setup.
- Worker-thread telemetry ingestion.
- MongoDB bucket storage and indexes.
- React + TypeScript dashboard layout.
- Initial k6 load-testing scripts.

### Week 2
- Redis Pub/Sub integration.
- Socket.IO binary telemetry delivery.
- Frontend Socket.IO connection and telemetry hooks.
- Live dashboard updates verified without refreshing the browser.

## Verification Notes

- Frontend production build: passed.
- Binary telemetry delivery test: passed.
- Live dashboard update test: passed.
- A 50 RPS k6 ingestion test passed with no failed requests or dropped iterations.
- The 2,000 requests/second target and sustained high-frequency frontend performance have not yet been verified.

## Getting Started

### Backend

1. Configure the environment variables using `backend/.env.example`.
2. Install backend dependencies:

   ```bash
   cd backend
   npm install
   ```

3. Start the backend using the available development script in `backend/package.json`.

### Frontend

1. Install frontend dependencies:

   ```bash
   cd frontend
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

## Current Scope

This documentation covers Week 1 and Week 2. Geofence alerts, custom Canvas rendering, and later deployment work remain outside the current scope.