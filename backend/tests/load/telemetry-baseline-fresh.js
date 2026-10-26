import http from 'k6/http';
import { check } from 'k6';

const runId = __ENV.RUN_ID;
if (!runId) {
  throw new Error('Set RUN_ID to a unique value for this test.');
}

const vehicleId = `VH-BASELINE-${runId}`;

export const options = {
  scenarios: {
    telemetry_ingestion: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 100,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    dropped_iterations: ['count==0'],
  },
};

export default function () {
  const response = http.post(
    'http://localhost:5000/api/telemetry/ingest',
    JSON.stringify({
      vehicleId,
      latitude: 28.6139,
      longitude: 77.2090,
      timestamp: new Date().toISOString(),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: '30s',
    }
  );

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response reports success': (r) => {
      try {
        return JSON.parse(r.body).success === true;
      } catch {
        return false;
      }
    },
  });
}
