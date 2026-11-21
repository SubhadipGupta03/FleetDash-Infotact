import { useEffect, useState } from 'react'
import {
  socket,
  type ConnectionStatus,
  type TelemetryPoint,
  type GeofenceAlert,
} from '../services/socket'
import {
  updateLatestPosition,
  notifyLatestPositionsChanged,
} from '../services/telemetryStore'

const MAX_TELEMETRY_POINTS = 5000
const FLUSH_INTERVAL_MS = 100
const MAX_GEOFENCE_ALERTS = 100
const MAX_PENDING_TELEMETRY = 10000
const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000'

type TelemetryState = {
  connected: boolean
  connectionStatus: ConnectionStatus | null
  telemetry: TelemetryPoint[]
  alerts: GeofenceAlert[]
  error: string | null
  historyStatus: 'loading' | 'available' | 'unavailable'
}

type TelemetryHistoryResponse = {
  success: boolean
  totalVehicles: number
  totalTelemetryEvents: number
  vehicles: {
    vehicleId: string
    latitude: number
    longitude: number
    timestamp: string | number | Date
    telemetryCount: number
  }[]
  geofenceAlerts: GeofenceAlert[]
  recentBuckets: {
    vehicleId: string
    readings: {
      eventId?: string
      timestamp: string | number | Date
      latitude: number
      longitude: number
    }[]
  }[]
}

function isTelemetryPoint(value: unknown): value is TelemetryPoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const point = value as Record<string, unknown>

  return (
    typeof point.vehicleId === 'string' &&
    point.vehicleId.trim().length > 0 &&
    typeof point.latitude === 'number' &&
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  )
}

function decodeTelemetry(
  payload: unknown,
): TelemetryPoint | TelemetryPoint[] | null {
  let data: unknown = payload

  if (data instanceof ArrayBuffer) {
    data = new TextDecoder().decode(data)
  } else if (ArrayBuffer.isView(data)) {
    data = new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    )
  } else if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    'type' in data &&
    (data as { type?: unknown }).type === 'Buffer' &&
    'data' in data &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    const bytes = (data as { data: unknown[] }).data

    if (
      !bytes.every(
        (value) =>
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 255,
      )
    ) {
      return null
    }

    data = new TextDecoder().decode(new Uint8Array(bytes as number[]))
  }

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown
    } catch {
      return null
    }
  }

  if (Array.isArray(data)) {
    return data.length > 0 && data.every(isTelemetryPoint)
      ? data
      : null
  }

  return isTelemetryPoint(data) ? data : null
}

export function useTelemetry() {
  const [state, setState] = useState<TelemetryState>({
  connected: socket.connected,
  connectionStatus: null,
  telemetry: [],
  alerts: [],
  error: null,
  historyStatus: 'loading',
})

  useEffect(() => {
    let pending: TelemetryPoint[] = []

    function flushTelemetry() {
      if (pending.length === 0) return

      const batch = pending
      pending = []
      notifyLatestPositionsChanged()

      setState((previous) => ({
        ...previous,
        telemetry: [...previous.telemetry, ...batch].slice(
          -MAX_TELEMETRY_POINTS,
        ),
        error: null,
      }))
    }
    notifyLatestPositionsChanged()

    const flushTimer = setInterval(flushTelemetry, FLUSH_INTERVAL_MS)
    const historyController = new AbortController()

    async function loadTelemetryHistory() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/telemetry/history`,
          { signal: historyController.signal },
        )

        if (!response.ok) {
          throw new Error(
            `History API failed with status ${response.status}`,
          )
        }

        const history =
          (await response.json()) as TelemetryHistoryResponse

        if (!history.success) {
          throw new Error('Failed to load telemetry history.')
        }

        for (const vehicle of history.vehicles) {
          updateLatestPosition({
            vehicleId: vehicle.vehicleId,
            latitude: vehicle.latitude,
            longitude: vehicle.longitude,
            timestamp:
              vehicle.timestamp instanceof Date
                ? vehicle.timestamp.toISOString()
                : vehicle.timestamp,
          })
        }
        notifyLatestPositionsChanged()

        const historicalTelemetry: TelemetryPoint[] =
          history.recentBuckets.flatMap((bucket) =>
            bucket.readings.map((reading) => ({
              vehicleId: bucket.vehicleId,
              latitude: reading.latitude,
              longitude: reading.longitude,
              timestamp:
                reading.timestamp instanceof Date
                  ? reading.timestamp.toISOString()
                  : reading.timestamp,
              eventId: reading.eventId,
            })),
          )

        for (const point of historicalTelemetry) {
          updateLatestPosition(point)
        }
        notifyLatestPositionsChanged()

        setState((previous) => {
          const combined = [
            ...historicalTelemetry,
            ...previous.telemetry,
          ]

          const uniqueTelemetry = Array.from(
            new Map(
              combined.map((point) => [
                typeof point.eventId === 'string'
                  ? point.eventId
                  : `${point.vehicleId}-${point.timestamp}-${point.latitude}-${point.longitude}`,
                point,
              ]),
            ).values(),
          )

          return {
            ...previous,
            telemetry: uniqueTelemetry.slice(-MAX_TELEMETRY_POINTS),
            alerts: Array.from(
              new Map(
                [...previous.alerts, ...history.geofenceAlerts].map(
                  (alert) => [alert._id, alert],
                ),
              ).values(),
            ).slice(0, MAX_GEOFENCE_ALERTS),
            error: null,
historyStatus: 'available',
          }
        })
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === 'AbortError'
        ) {
          return
        }

        setState((previous) => ({
  ...previous,
  historyStatus: 'unavailable',
  error:
    error instanceof Error
      ? error.message
      : 'Unable to load telemetry history.',
}))
      }
    }

    void loadTelemetryHistory()

    function handleConnect() {
      setState((previous) => ({
        ...previous,
        connected: true,
        error: null,
      }))
    }

    function handleDisconnect() {
      setState((previous) => ({
        ...previous,
        connected: false,
      }))
    }

    function handleConnectionStatus(status: ConnectionStatus) {
      setState((previous) => ({
        ...previous,
        connectionStatus: status,
      }))
    }

    function handleConnectionError(error: Error) {
      setState((previous) => ({
        ...previous,
        connected: false,
        error: error.message,
      }))
    }

    function handleTelemetry(payload: unknown) {
      const decoded = decodeTelemetry(payload)

      if (!decoded) {
        setState((previous) => ({
          ...previous,
          error: 'Received an invalid telemetry payload.',
        }))
        return
      }

      const points = Array.isArray(decoded) ? decoded : [decoded]

      for (const point of points) {
        updateLatestPosition(point)
        pending.push(point)
      }

      if (pending.length > MAX_PENDING_TELEMETRY) {
        pending = pending.slice(-MAX_PENDING_TELEMETRY)
      }
    }

    function handleGeofenceAlert(payload: unknown) {
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('vehicleId' in payload) ||
        !('message' in payload) ||
        !('type' in payload) ||
        (payload as Record<string, unknown>).type !== 'GEOFENCE_BREACH'
      ) {
        console.warn('Received an invalid geofence alert payload.')
        return
      }

      const alert = payload as GeofenceAlert

      setState((previous) => {
        const alreadyExists = previous.alerts.some(
          (existing) => existing._id === alert._id,
        )

        if (alreadyExists) {
          return previous
        }

        return {
          ...previous,
          alerts: [alert, ...previous.alerts].slice(
            0,
            MAX_GEOFENCE_ALERTS,
          ),
        }
      })
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectionError)
    socket.on('connection-status', handleConnectionStatus)
    socket.on('telemetry-update', handleTelemetry)
    socket.on('geofence-alert', handleGeofenceAlert)

    if (!socket.connected) {
      socket.connect()
    }

    return () => {
      clearInterval(flushTimer)
      historyController.abort()
      flushTelemetry()

      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectionError)
      socket.off('connection-status', handleConnectionStatus)
      socket.off('telemetry-update', handleTelemetry)
      socket.off('geofence-alert', handleGeofenceAlert)
    }
  }, [])

  return state
}