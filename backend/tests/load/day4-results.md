# FleetDash — Week 1 Day 4 Test Results

**Date:** 16 October 2026  
**Branch:** `subhadip-backend`  
**Project:** High-Throughput Event-Driven Fleet Telemetry Dashboard  
**Scope:** Backend ingestion, MongoDB storage and indexing, load testing, Redis Pub/Sub, Socket.IO binary delivery, and reconnect verification.

---

## 1. MongoDB Index Verification

| Property | Result |
|---|---|
| Database | `fleetdash` |
| Collection | `telemetryBuckets` |
| Index name | `vehicle_bucket_unique` |
| Indexed fields | `vehicleId` ascending, `bucketStart` ascending |
| Index type | Unique compound index |
| Atlas status | READY |

**Result: PASS**

The expected compound index was available in MongoDB Atlas for vehicle and hourly-bucket lookups.

## 2. Initial k6 Controlled Load Test

**Configuration**

- Endpoint: `POST /api/telemetry/ingest`
- Virtual users: 5
- Total iterations: 20

**Results**

| Metric | Result |
|---|---:|
| HTTP requests | 20 |
| Failed requests | 0 (0%) |
| Checks passed | 40/40 (100%) |
| Average response time | 291.25 ms |
| Median response time | 187.25 ms |
| p90 response time | 752.38 ms |
| p95 response time | 846.69 ms |
| Maximum response time | 886.41 ms |
| Observed throughput | 9.27 requests/second |

**Result: PASS for the controlled test**

The endpoint completed the 20-request test without failed requests. This small test does not establish the system's maximum or sustained throughput.

## 3. Initial MongoDB Query Explain Results

| Metric | Result |
|---|---|
| Winning index | `vehicle_bucket_unique` |
| Query stages | `IXSCAN` followed by `FETCH` |
| Documents returned | 1 |
| Index keys examined | 1 |
| Documents examined | 1 |
| `executionTimeMillis` | 0 |

**Result: PASS for the tested lookup**

MongoDB selected the intended index and examined one index key and one document. The reported execution time has whole-millisecond precision; a value of `0` does not imply literal zero latency.

## 4. Initial Findings

- The ingestion endpoint handled the initial controlled test without failed requests.
- MongoDB selected the expected compound index.
- The tested lookup examined one index key and one document.
- The initial k6 test was small and cannot establish maximum system capacity.
- The initial explain result was a single-query measurement; repeated explain measurements are documented in Section 8.

## 5. Performance Validation Status

The following performance checks were required beyond the initial smoke test:

- Run larger, controlled load tests.
- Benchmark query performance over repeated runs.
- Compare ingestion requests with stored telemetry readings.
- Evaluate dropped iterations and failed requests under higher load.
- Verify whether the assignment target of **2,000 requests/second with zero telemetry omissions** can be achieved.

**Conclusion:** Initial index and smoke-test checks passed. The 2,000 requests/second target with zero omissions remains unverified. The recorded 90 RPS tests had dropped iterations, so the target must not be claimed as achieved.

## 6. Repeated MongoDB Query Benchmark

**Measurement:** 100 sequential queries after 10 warm-up queries.

| Metric | Result |
|---|---:|
| Queries measured | 100 |
| Average round-trip latency | 114.937 ms |
| Median round-trip latency | 110.301 ms |
| p95 round-trip latency | 133.881 ms |
| Minimum round-trip latency | 77.506 ms |
| Maximum round-trip latency | 534.190 ms |

**Interpretation:** These measurements include client-to-MongoDB Atlas network latency. They are round-trip timings, not server-only query execution times.

## 7. Extended k6 Load-Test Evidence

The tests used k6's `constant-arrival-rate` executor against `POST /api/telemetry/ingest`. Each configured test ran for 10 seconds.

### 7.1 Results summary

| Test | Configured rate | HTTP requests | Failed HTTP requests | Dropped iterations | Average response time | p95 response time | Assessment |
|---|---:|---:|---:|---:|---:|---:|---|
| 50 RPS verification | 50 req/s | 501 | 0 | 0 | 433.59 ms | 1.06 s | Passed configured thresholds |
| 75 RPS retry | 75 req/s | 751 | 0 | 0 | ~226 ms | ~264 ms | Passed configured thresholds |
| 90 RPS, max 100 VUs | 90 req/s | 812 | 0 | 88 | ~778 ms | ~1.93 s | Failed dropped-iteration threshold |
| 90 RPS, max 200 VUs | 90 req/s | 873 | 0 | 28 | ~1.44 s | ~2.07 s | Failed dropped-iteration threshold |

The 50 RPS verification run used the separate vehicle ID `VH-K6-RAMP50-VERIFY-20261024`, allowing its stored-reading count to be checked independently. Other test vehicle IDs were reused across attempts, so their cumulative MongoDB counts must not be interpreted as individual-run counts.

### 7.2 Storage reconciliation

For the isolated 50 RPS verification run:

| Metric | Result |
|---|---:|
| k6 HTTP requests | 501 |
| Failed HTTP requests | 0 |
| Dropped iterations | 0 |
| MongoDB readings verified for the test vehicle | 501 |

**Result: PASS for the isolated reconciliation**

The observed HTTP request count matched the stored-reading count for this run.

The 75 RPS test vehicle had 1,502 cumulative readings across two hourly buckets. This count accumulated across test runs and is not a per-run reconciliation.

### 7.3 Interpretation and limitations

- The 50 and 75 RPS tests passed their configured k6 thresholds.
- Both 90 RPS tests recorded zero failed HTTP requests, but dropped iterations exceeded the required zero. Therefore, neither test passed all configured thresholds.
- Increasing the maximum virtual-user allocation from 100 to 200 reduced dropped iterations from 88 to 28 but did not eliminate them.
- These short tests do not establish sustained capacity at the configured arrival rates.
- The assignment target of 2,000 requests/second with zero telemetry omissions has **not been demonstrated**.
- MongoDB Atlas round-trip latency and server-side query execution time are different measurements; see Sections 3 and 6.

## 8. Repeated MongoDB Explain Verification

**Measurement:** 100 `executionStats` explain runs against a sample telemetry bucket.

| Metric | Result |
|---|---:|
| Explain runs | 100 |
| Runs using `vehicle_bucket_unique` | 100/100 |
| Runs reporting under 5 ms | 100/100 |
| Maximum index keys examined | 1 |
| Maximum documents examined | 1 |
| Runs returning exactly one document | 100/100 |
| Maximum reported execution time | 0 ms |
| Average reported execution time | 0 ms |
| p95 reported execution time | 0 ms |

MongoDB reported `executionTimeMillis: 0` for all 100 runs.

**Interpretation:** All runs selected the expected compound index and examined at most one index key and one document. The reported execution-time field was under 5 ms in every run. Because this field has whole-millisecond precision, the results do not establish literal zero latency or precise sub-millisecond execution time.

## 9. Socket.IO Binary Transport Verification

The tested backend flow is:

1. The server receives telemetry messages through Redis Pub/Sub.
2. The server parses each message as JSON.
3. The telemetry object is serialized and converted into a Node.js `Buffer`.
4. The server emits the payload through the `telemetry-update` Socket.IO event.

**Verification results**

- A Node.js Socket.IO client received binary telemetry and decoded the expected vehicle ID.
- The two-client test verified that both connected clients received the same telemetry update.

**Result: PASS for the tested Node.js clients**

**Limitation:** Browser-side `ArrayBuffer` or `Uint8Array` representation has not been verified. Browser/frontend validation is outside the scope of these backend tests.

## 10. Multi-Client Delivery and Reconnect Verification

### 10.1 Multi-client delivery

**Result: PASS**

- Two Node.js Socket.IO clients connected to the backend.
- One telemetry ingestion request returned HTTP 200.
- Both clients received binary telemetry.
- The test checked that the received telemetry matched the generated vehicle ID.
- The test completed successfully after both clients received the update.

### 10.2 Client reconnect

**Result: PASS**

- The initial Socket.IO connection was established.
- The client disconnected intentionally.
- The client reconnected successfully.
- Telemetry ingestion returned HTTP 200.
- Matching telemetry was received after reconnection.
- The received payload was verified as binary.

**Scope and limitation:** These tests verify delivery to two connected Node.js clients and telemetry delivery after a scripted reconnect. They do not establish behavior under hundreds of concurrent clients, prolonged network outages, or guaranteed recovery of events emitted while a client is disconnected.

## 11. End-to-End Backend Telemetry Flow

### 11.1 Request and validation

1. A client submits telemetry using `POST /api/telemetry/ingest`.
2. Express routes the request to `routes/telemetry.js`.
3. `processTelemetry()` sends the payload to the worker pool.
4. `workers/telemetryWorker.js` validates the vehicle ID, latitude, longitude, and timestamp.
5. Invalid telemetry returns HTTP 400. A full worker queue returns HTTP 503.

### 11.2 Storage and event publishing

6. Valid telemetry is passed to `storeTelemetry()` in `config/telemetryBuckets.js`.
7. MongoDB stores the reading in the vehicle's UTC hourly bucket, updating its readings and count.
8. The route publishes the validated telemetry as JSON to the Redis channel `fleetdash:telemetry`.
9. If storage and publishing succeed, the ingestion route returns HTTP 200.

### 11.3 Real-time delivery

10. The Redis subscriber in `server.js` receives the published message.
11. The server parses the JSON message and converts it into a Node.js `Buffer`.
12. Socket.IO broadcasts the binary payload using the `telemetry-update` event.
13. Connected clients can receive and decode the telemetry payload.

### 11.4 Verification and limitations

- Worker validation, hourly bucket boundaries, repeated ingestion, Redis-to-Socket.IO binary delivery, two-client delivery, and scripted reconnect have been tested separately.
- MongoDB explain tests verified use of the expected compound index for the tested queries.
- The 2,000 requests/second target with zero omissions has not been demonstrated.
- Redis deployment topology remains unconfirmed.
- Browser-specific `ArrayBuffer` or `Uint8Array` payload handling has not been verified; the binary transport tests used Node.js clients.
- These results document the tested backend flow and do not establish performance or reliability beyond the recorded tests.

---

## Overall Assessment

The recorded tests verify the principal backend ingestion, validation, MongoDB hourly bucket storage, indexed lookup, Redis Pub/Sub, binary Socket.IO delivery, multi-client delivery, and scripted reconnect paths.

The higher-throughput acceptance target remains outstanding: the available 90 RPS tests recorded dropped iterations, and no successful 2,000 RPS test with zero telemetry omissions has been demonstrated. Redis topology and browser-specific binary representation also remain unverified.

This report distinguishes verified test results from targets and behaviors that have not yet been demonstrated.