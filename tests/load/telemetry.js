
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 1,
  iterations: 5,
};

export default function () {
  const url = 'http://localhost:5000/api/telemetry/ingest';

  const payload = JSON.stringify({
    vehicleId: 'VH-K6-TEST',
    latitude: 28.6139,
    longitude: 77.2090,
    timestamp: new Date().toISOString(),
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(url, payload, params);

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

  sleep(0.2);
}
