import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    telemetry_ingestion: {
      executor: 'constant-arrival-rate',
      rate: 90,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 100,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    dropped_iterations: ['count==0'],
  },
};

export default function () {
  const response = http.post(
    'http://localhost:5000/api/telemetry/ingest',
    JSON.stringify({
      vehicleId: 'VH-K6-RAMP90-RETRY-20261023',
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
