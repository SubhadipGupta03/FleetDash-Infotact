
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket'],
})

export type ConnectionStatus = {
  connected?: boolean
  message?: string
  status?: string
}

export type TelemetryPoint = {
  vehicleId: string
  latitude: number
  longitude: number
  timestamp?: string | number
  [key: string]: unknown
}
