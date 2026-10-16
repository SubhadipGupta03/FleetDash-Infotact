
# FleetDash — Week 1 Day 4 Test Results

**Date:** 16 October 2026  
**Branch:** `subhadip-backend`

## 1. MongoDB Index Verification

- Database: `fleetdash`
- Collection: `telemetryBuckets`
- Index: `vehicle_bucket_unique`
- Indexed fields: `vehicleId` ascending, `bucketStart` ascending
- Index properties: Unique, Compound
- Atlas status: READY

## 2. k6 Controlled Load Test

**Configuration**
- Virtual users: 5
- Total iterations: 20
- Endpoint: `POST /api/telemetry/ingest`

**Results**
- HTTP requests: 20
- Failed requests: 0 (0%)
- Checks passed: 40/40 (100%)
- Average response time: 291.25 ms
- Median response time: 187.25 ms
- 90th percentile: 752.38 ms
- 95th percentile: 846.69 ms
- Maximum response time: 886.41 ms
- Observed throughput: 9.27 requests/second

## 3. MongoDB Query Explain Results

- Winning index: `vehicle_bucket_unique`
- Query stage: `IXSCAN` followed by `FETCH`
- Documents returned: 1
- Index keys examined: 1
- Documents examined: 1
- `executionTimeMillis`: 0

The reported execution time is rounded to millisecond resolution and does not imply literal zero latency.

## 4. Findings

- The ingestion endpoint handled this controlled test without failed requests.
- The intended compound index was selected by MongoDB.
- The query examined one index key and one document for the tested lookup.
- The k6 test was small and does not establish maximum system capacity.
- The query explain result is a single-query measurement, not a repeated benchmark.

## 5. Remaining Performance Validation

- Run larger, controlled load tests.
- Benchmark query performance over repeated runs.
- Measure ingestion throughput and check for missing telemetry records.
- Evaluate the assignment target of 2,000 requests/second and query execution under 5 ms under an appropriate test workload.

**Conclusion:** Initial Day 4 index and smoke/load-test checks passed. High-throughput performance targets remain unverified.
