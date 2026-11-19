import { useEffect, useRef } from 'react'
import {
  MapContainer,
  TileLayer,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import type { TelemetryPoint } from '../services/socket'
import CanvasVehicleLayer from './CanvasVehicleLayer'
import 'leaflet/dist/leaflet.css'

type FleetMapProps = {
  vehicles: TelemetryPoint[]
  selectedVehicleId: string | null
  onSelectVehicle: (vehicleId: string) => void
}

const DEFAULT_CENTER: [number, number] = [22.5726, 88.3639]


type MapUpdaterProps = {
  vehicles: TelemetryPoint[]
  selectedVehicleId: string | null
}

function MapUpdater({ vehicles, selectedVehicleId }: MapUpdaterProps) {
  const map = useMap()

  const lastActionRef = useRef({
    selectedVehicleId: null as string | null,
    latitude: null as number | null,
    longitude: null as number | null,
    hasFittedInitialBounds: false,
  })

  useEffect(() => {
    const lastAction = lastActionRef.current

    if (selectedVehicleId) {
      const selectedVehicle = vehicles.find(
        (vehicle) => vehicle.vehicleId === selectedVehicleId,
      )

      if (!selectedVehicle) return

      const selectionChanged =
        lastAction.selectedVehicleId !== selectedVehicleId

      if (selectionChanged) {
        map.flyTo(
          [selectedVehicle.latitude, selectedVehicle.longitude],
          15,
          { duration: 0.8 },
        )

        lastActionRef.current = {
          ...lastAction,
          selectedVehicleId,
          latitude: selectedVehicle.latitude,
          longitude: selectedVehicle.longitude,
        }
      }

      return
    }

    if (lastAction.selectedVehicleId !== null) {
      lastActionRef.current = {
        ...lastAction,
        selectedVehicleId: null,
        latitude: null,
        longitude: null,
      }
    }

    if (lastActionRef.current.hasFittedInitialBounds) return

    if (vehicles.length === 1) {
      map.setView(
        [vehicles[0].latitude, vehicles[0].longitude],
        13,
      )

      lastActionRef.current.hasFittedInitialBounds = true
    } else if (vehicles.length > 1) {
      const bounds = L.latLngBounds(
        vehicles.map((vehicle) => [
          vehicle.latitude,
          vehicle.longitude,
        ] as [number, number]),
      )

      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
      lastActionRef.current.hasFittedInitialBounds = true
    }
  }, [vehicles, selectedVehicleId, map])

  return null
}

export default function FleetMap({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
}: FleetMapProps) {
  return (
    <div className="fleet-map">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={6}
        scrollWheelZoom
        className="fleet-map-container"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <CanvasVehicleLayer
          selectedVehicleId={selectedVehicleId}
          onSelectVehicle={onSelectVehicle}
        />

        <MapUpdater
          vehicles={vehicles}
          selectedVehicleId={selectedVehicleId}
        />
      </MapContainer>
    </div>
  )
}
