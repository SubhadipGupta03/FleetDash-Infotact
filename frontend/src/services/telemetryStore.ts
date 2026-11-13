
import type { TelemetryPoint } from './socket'

const latestPositions = new Map<string, TelemetryPoint>()

function getTimestamp(point: TelemetryPoint): number | null {
  const value = point.timestamp

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export function updateLatestPosition(point: TelemetryPoint): void {
  const current = latestPositions.get(point.vehicleId)

  if (current) {
    const incomingTime = getTimestamp(point)
    const currentTime = getTimestamp(current)

    if (
      incomingTime !== null &&
      currentTime !== null &&
      incomingTime < currentTime
    ) {
      return
    }
  }

  latestPositions.set(point.vehicleId, point)
}

export function getLatestPositions(): Map<string, TelemetryPoint> {
  return latestPositions
}

export function clearLatestPositions(): void {
  latestPositions.clear()
}
