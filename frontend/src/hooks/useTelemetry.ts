
import { useEffect, useState } from 'react'
import {
  socket,
  type ConnectionStatus,
  type TelemetryPoint,
} from '../services/socket'

const MAX_TELEMETRY_POINTS = 5000
const FLUSH_INTERVAL_MS = 100

type TelemetryState = {
  connected: boolean
  connectionStatus: ConnectionStatus | null
  telemetry: TelemetryPoint[]
  error: string | null
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
    error: null,
  })

  useEffect(() => {
    let pending: TelemetryPoint[] = []

    function flushTelemetry() {
      if (pending.length === 0) return

      const batch = pending
      pending = []

      setState((previous) => ({
        ...previous,
        telemetry: [...previous.telemetry, ...batch].slice(
          -MAX_TELEMETRY_POINTS,
        ),
        error: null,
      }))
    }

    const flushTimer = setInterval(flushTelemetry, FLUSH_INTERVAL_MS)

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

      pending.push(...(Array.isArray(decoded) ? decoded : [decoded]))
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectionError)
    socket.on('connection-status', handleConnectionStatus)
    socket.on('telemetry-update', handleTelemetry)

    if (!socket.connected) {
      socket.connect()
    }

    return () => {
      clearInterval(flushTimer)
      flushTelemetry()

      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectionError)
      socket.off('connection-status', handleConnectionStatus)
      socket.off('telemetry-update', handleTelemetry)
    }
  }, [])

  return state
}
