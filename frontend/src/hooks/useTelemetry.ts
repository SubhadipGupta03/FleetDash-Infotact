
import { useEffect, useState } from 'react'
import {
  socket,
  type ConnectionStatus,
  type TelemetryPoint,
} from '../services/socket'

type TelemetryState = {
  connected: boolean
  connectionStatus: ConnectionStatus | null
  telemetry: TelemetryPoint[]
  error: string | null
}

function decodeTelemetry(payload: unknown): TelemetryPoint | TelemetryPoint[] | null {
  let data: unknown = payload

  if (data instanceof ArrayBuffer) {
    data = new TextDecoder().decode(data)
  } else if (ArrayBuffer.isView(data)) {
    data = new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    )
  }

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown
    } catch {
      return null
    }
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const possibleBuffer = data as { type?: unknown; data?: unknown }

    if (
      possibleBuffer.type === 'Buffer' &&
      Array.isArray(possibleBuffer.data) &&
      possibleBuffer.data.every(
        (value) => typeof value === 'number' && value >= 0 && value <= 255,
      )
    ) {
      return decodeTelemetry(new Uint8Array(possibleBuffer.data))
    }
  }

  if (Array.isArray(data)) {
    return data as TelemetryPoint[]
  }

  if (data && typeof data === 'object') {
    return data as TelemetryPoint
  }

  return null
}

export function useTelemetry() {
  const [state, setState] = useState<TelemetryState>({
    connected: false,
    connectionStatus: null,
    telemetry: [],
    error: null,
  })

  useEffect(() => {
    function handleConnect() {
      setState((previous) => ({
        ...previous,
        connected: true,
        error: null,
      }))
    }

    function handleDisconnect() {
      setState((previous) => ({ ...previous, connected: false }))
    }

    function handleConnectionStatus(status: ConnectionStatus) {
      setState((previous) => ({
        ...previous,
        connectionStatus: status,
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

      const incoming = Array.isArray(decoded) ? decoded : [decoded]

      setState((previous) => ({
        ...previous,
        telemetry: [...previous.telemetry, ...incoming].slice(-5000),
        error: null,
      }))
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectionError)
    socket.on('connection-status', handleConnectionStatus)
    socket.on('telemetry-update', handleTelemetry)

    function handleConnectionError(error: Error) {
      setState((previous) => ({
        ...previous,
        connected: false,
        error: error.message,
      }))
    }

    socket.connect()

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectionError)
      socket.off('connection-status', handleConnectionStatus)
      socket.off('telemetry-update', handleTelemetry)
      socket.disconnect()
    }
  }, [])

  return state
}
