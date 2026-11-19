
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  getLatestPositions,
  subscribeLatestPositions,
} from '../services/telemetryStore'
import type { TelemetryPoint } from '../services/socket'

type CanvasVehicleLayerProps = {
  selectedVehicleId: string | null
  onSelectVehicle: (vehicleId: string) => void
}

const VEHICLE_RADIUS = 7
const SELECTED_RADIUS = 11
const HIT_RADIUS = 14

export default function CanvasVehicleLayer({
  selectedVehicleId,
  onSelectVehicle,
}: CanvasVehicleLayerProps) {
  const map = useMap()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const selectedRef = useRef(selectedVehicleId)
  const drawRef = useRef<() => void>(() => {})
  const onSelectRef = useRef(onSelectVehicle)
  const hitTargetsRef = useRef<
    { vehicleId: string; x: number; y: number }[]
  >([])

  useEffect(() => {
  selectedRef.current = selectedVehicleId
  drawRef.current()
}, [selectedVehicleId])

  useEffect(() => {
    onSelectRef.current = onSelectVehicle
  }, [onSelectVehicle])

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'fleet-vehicle-canvas'
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '450'

    const mapContainer = map.getContainer()
mapContainer.appendChild(canvas)
    canvasRef.current = canvas

    const context = canvas.getContext('2d')

    if (!context) {
      canvas.remove()
      canvasRef.current = null
      return
    }


    function resizeCanvas() {
      const size = map.getSize()
      const pixelRatio = window.devicePixelRatio || 1

      canvas.width = size.x * pixelRatio
      canvas.height = size.y * pixelRatio
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`

      context!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }

function drawVehicles() {
  const size = map.getSize()

  context!.clearRect(0, 0, size.x, size.y)

  const positions = getLatestPositions()
  const groups = new Map<
    string,
    [string, TelemetryPoint][]
  >()

  for (const entry of positions) {
    const [vehicleId, vehicle] = entry
    const key = `${vehicle.latitude},${vehicle.longitude}`

    const group = groups.get(key) ?? []
    group.push([vehicleId, vehicle])
    groups.set(key, group)
  }

  const hitTargets: {
    vehicleId: string
    x: number
    y: number
  }[] = []

  for (const group of groups.values()) {
    const firstVehicle = group[0][1]

    const center = map.latLngToContainerPoint([
      firstVehicle.latitude,
      firstVehicle.longitude,
    ])

    group.forEach(([vehicleId], index) => {
      const selected = vehicleId === selectedRef.current

      const angle = (2 * Math.PI * index) / group.length
      const separation = group.length > 1 ? 28 : 0

      const x = center.x + Math.cos(angle) * separation
      const y = center.y + Math.sin(angle) * separation

      if (
        x < -HIT_RADIUS ||
        y < -HIT_RADIUS ||
        x > size.x + HIT_RADIUS ||
        y > size.y + HIT_RADIUS
      ) {
        return
      }

      if (group.length > 1) {
        context!.beginPath()
        context!.moveTo(center.x, center.y)
        context!.lineTo(x, y)
        context!.strokeStyle = '#20d6a1'
        context!.lineWidth = 1.5
        context!.setLineDash([3, 3])
        context!.stroke()
        context!.setLineDash([])
      }

      const radius = selected
        ? SELECTED_RADIUS
        : VEHICLE_RADIUS

      context!.beginPath()
      context!.arc(x, y, radius, 0, Math.PI * 2)
      context!.fillStyle = selected ? '#f5b942' : '#20d6a1'
      context!.fill()
      context!.lineWidth = selected ? 3 : 2
      context!.strokeStyle = '#071b2e'
      context!.stroke()

      if (selected) {
        context!.beginPath()
        context!.arc(x, y, radius + 5, 0, Math.PI * 2)
        context!.lineWidth = 2
        context!.strokeStyle = '#ffffff'
        context!.stroke()
      }

      hitTargets.push({
        vehicleId,
        x,
        y,
      })
    })
  }

  hitTargetsRef.current = hitTargets
}
drawRef.current = drawVehicles
const unsubscribe = subscribeLatestPositions(drawVehicles)

    function handleMapClick(event: L.LeafletMouseEvent) {
      const clickPoint = map.latLngToContainerPoint(event.latlng)

      for (const target of hitTargetsRef.current) {
        const distance = Math.hypot(
          clickPoint.x - target.x,
          clickPoint.y - target.y,
        )

        if (distance <= HIT_RADIUS) {
          onSelectRef.current(target.vehicleId)
          return
        }
      }
    }

    resizeCanvas()
drawVehicles()


map.on('resize', resizeCanvas)
map.on('move zoom', drawVehicles)
map.on('click', handleMapClick)

    return () => {
map.off('resize', resizeCanvas)
map.off('move zoom', drawVehicles)
map.off('click', handleMapClick)
unsubscribe()
drawRef.current = () => {}
      canvas.remove()
      canvasRef.current = null
      hitTargetsRef.current = []
    }
  }, [map])

  return null
}
