
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
const ACTIVE_WINDOW_MS = 60_000

function getTimestamp(point: TelemetryPoint): number {
  if (point.timestamp === undefined) return 0

  const value =
    typeof point.timestamp === 'number'
      ? point.timestamp
      : Date.parse(point.timestamp)

  if (!Number.isFinite(value)) return 0

  return value < 1e12 ? value * 1000 : value
}

function isVehicleActive(point: TelemetryPoint, now: number): boolean {
  const timestamp = getTimestamp(point)
  const age = now - timestamp

  return timestamp > 0 && age >= 0 && age <= ACTIVE_WINDOW_MS
}

export default function CanvasVehicleLayer({
  selectedVehicleId,
  onSelectVehicle,
}: CanvasVehicleLayerProps) {
  const map = useMap()
  const selectedRef = useRef(selectedVehicleId)
  const drawRef = useRef<() => void>(() => {})
  const onSelectRef = useRef(onSelectVehicle)
  const hitTargetsRef = useRef<
  {
    vehicleIds: string[]
    x: number
    y: number
    bounds: L.LatLngBounds
    isCluster: boolean
  }[]
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

    const context = canvas.getContext('2d')

if (!context) {
  canvas.remove()
  return
}

const ctx: CanvasRenderingContext2D = context

    function resizeCanvas() {
      const size = map.getSize()
      const pixelRatio = window.devicePixelRatio || 1

      canvas.width = Math.round(size.x * pixelRatio)
      canvas.height = Math.round(size.y * pixelRatio)
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }


function drawVehicles() {
  const size = map.getSize()
  ctx.clearRect(0, 0, size.x, size.y)

  const positions = getLatestPositions()
  const now = Date.now()
  const groups = new Map<string, [string, TelemetryPoint][]>()
  const clusterMode = false
  const CLUSTER_CELL_SIZE = 60

  for (const [vehicleId, vehicle] of positions) {
    const point = map.latLngToContainerPoint([
      vehicle.latitude,
      vehicle.longitude,
    ])

    const key = clusterMode
      ? `${Math.floor(point.x / CLUSTER_CELL_SIZE)},${Math.floor(point.y / CLUSTER_CELL_SIZE)}`
      : `${vehicle.latitude},${vehicle.longitude}`

    const group = groups.get(key) ?? []
    group.push([vehicleId, vehicle])
    groups.set(key, group)
  }

  const hitTargets: {
    vehicleIds: string[]
    x: number
    y: number
    bounds: L.LatLngBounds
    isCluster: boolean
  }[] = []

  for (const group of groups.values()) {
    const bounds = L.latLngBounds(
      group.map(([, vehicle]) => [
        vehicle.latitude,
        vehicle.longitude,
      ] as L.LatLngTuple),
    )

    const center = map.latLngToContainerPoint(bounds.getCenter())

    if (
      center.x < -30 ||
      center.y < -30 ||
      center.x > size.x + 30 ||
      center.y > size.y + 30
    ) {
      continue
    }

    // Combine nearby vehicles into a count marker at lower zoom levels.
    if (clusterMode && group.length > 1) {
      const activeCount = group.filter(([, vehicle]) =>
        isVehicleActive(vehicle, now),
      ).length
      const staleCount = group.length - activeCount

      ctx.beginPath()
      ctx.arc(center.x, center.y, 18, 0, Math.PI * 2)
      ctx.fillStyle = '#10243a'
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle =
        activeCount > 0 && staleCount > 0
          ? '#60a5fa'
          : activeCount > 0
            ? '#20d6a1'
            : '#f5b942'
      ctx.stroke()

      ctx.fillStyle = '#ffffff'
      ctx.font = '600 12px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(group.length), center.x, center.y)

      hitTargets.push({
        vehicleIds: group.map(([vehicleId]) => vehicleId),
        x: center.x,
        y: center.y,
        bounds,
        isCluster: true,
      })

      continue
    }

    // Show individual vehicles; spread identical coordinates apart.
    group.forEach(([vehicleId, vehicle], index) => {
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
        ctx.beginPath()
        ctx.moveTo(center.x, center.y)
        ctx.lineTo(x, y)
        ctx.strokeStyle = '#20d6a1'
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])
      }

      const radius = selected ? SELECTED_RADIUS : VEHICLE_RADIUS

      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = isVehicleActive(vehicle, now)
        ? '#20d6a1'
        : '#f5b942'
      ctx.fill()
      ctx.lineWidth = selected ? 3 : 2
      ctx.strokeStyle = '#071b2e'
      ctx.stroke()

      if (selected) {
        ctx.beginPath()
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2)
        ctx.lineWidth = 2
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
      }

      hitTargets.push({
        vehicleIds: [vehicleId],
        x,
        y,
        bounds,
        isCluster: false,
      })
    })
  }

  hitTargetsRef.current = hitTargets
}

function handleMapClick(event: L.LeafletMouseEvent) {
  const clickPoint = map.latLngToContainerPoint(event.latlng)

  for (const target of hitTargetsRef.current) {
    const distance = Math.hypot(
      clickPoint.x - target.x,
      clickPoint.y - target.y,
    )

    const hitRadius = target.isCluster ? 22 : HIT_RADIUS

    if (distance <= hitRadius) {
      if (target.isCluster) {
        map.fitBounds(target.bounds, {
          padding: [60, 60],
          maxZoom: 17,
        })
      } else {
        onSelectRef.current(target.vehicleIds[0])
      }

      return
    }
  }
}
function handleMapResize() {
  resizeCanvas()
  drawVehicles()
}


    drawRef.current = drawVehicles
    const freshnessTimer = window.setInterval(drawVehicles, 1000)
    const unsubscribe = subscribeLatestPositions(drawVehicles)

    handleMapResize()

    map.on('resize', handleMapResize)
    map.on('move zoom', drawVehicles)
    map.on('click', handleMapClick)

    return () => {
      map.off('resize', handleMapResize)
      map.off('move zoom', drawVehicles)
      map.off('click', handleMapClick)

      unsubscribe()
      window.clearInterval(freshnessTimer)
      drawRef.current = () => {}
      canvas.remove()
      hitTargetsRef.current = []
    }
  }, [map])

  return null
}
