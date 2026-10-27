
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  iterations: 20,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const url = 'http://localhost:5000/api/telemetry/ingest';

  const payload = JSON.stringify({
    eventId: `k6-${Date.now()}-${__VU}-${__ITER}`,
    vehicleId: 'VH-K6-CLEAN-001',
    latitude: 28.6139,
    longitude: 77.2090,
    timestamp: new Date().toISOString(),
  });

  const response = http.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '30s',
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response reports success': (r) => {
      try {
        return JSON.parse(r.body).success === true;
      } catch {
        return false;
      }
    },
    'event is not a duplicate': (r) => {
      try {
        return JSON.parse(r.body).duplicate === false;
      } catch {
        return false;
      }
    },
  });

  sleep(0.2);
}
