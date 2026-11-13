import FleetMap from './components/FleetMap'
import './App.css'
import { useEffect, useMemo, useState } from 'react'
import { useTelemetry } from './hooks/useTelemetry'
import type { TelemetryPoint } from './services/socket'

const ACTIVE_WINDOW_MS = 60_000

function getTimestamp(point: TelemetryPoint): number {
  if (point.timestamp === undefined) return 0

  const value =
    typeof point.timestamp === 'number'
      ? point.timestamp
      : Date.parse(point.timestamp)

  if (!Number.isFinite(value)) return 0

  // Support Unix timestamps expressed in seconds or milliseconds.
  return value < 1e12 ? value * 1000 : value
}

function App() {
  const [now, setNow] = useState(0)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

useEffect(() => {
  const updateNow = () => setNow(Date.now())
  updateNow()
  const interval = setInterval(updateNow, 1000)
  return () => clearInterval(interval)
}, [])
  const { connected, connectionStatus, telemetry, alerts, error } = useTelemetry()

  const latestVehicles = useMemo(() => {
    const latestByVehicle = new Map<string, TelemetryPoint>()

    for (const point of telemetry) {
      if (!point.vehicleId) continue

      const previous = latestByVehicle.get(point.vehicleId)

      if (
        !previous ||
        getTimestamp(point) >= getTimestamp(previous)
      ) {
        latestByVehicle.set(point.vehicleId, point)
      }
    }

    return Array.from(latestByVehicle.values()).sort((a, b) =>
      a.vehicleId.localeCompare(b.vehicleId),
    )
  }, [telemetry])

  const activeVehicles = latestVehicles.filter((vehicle) => {
    const timestamp = getTimestamp(vehicle)
    const age = now - timestamp

    return timestamp > 0 && age >= 0 && age <= ACTIVE_WINDOW_MS
  })

  const validLocations = latestVehicles.filter(
    (vehicle) =>
      Number.isFinite(vehicle.latitude) &&
      Number.isFinite(vehicle.longitude) &&
      vehicle.latitude >= -90 &&
      vehicle.latitude <= 90 &&
      vehicle.longitude >= -180 &&
      vehicle.longitude <= 180,
  )

  const selectedVehicle =
  validLocations.find(
    (vehicle) => vehicle.vehicleId === selectedVehicleId,
  ) ?? null

const selectedVehicleTimestamp = selectedVehicle
  ? getTimestamp(selectedVehicle)
  : 0

const selectedVehicleIsActive =
  selectedVehicleTimestamp > 0 &&
  now - selectedVehicleTimestamp >= 0 &&
  now - selectedVehicleTimestamp <= ACTIVE_WINDOW_MS

const selectedVehicleUpdateCount = selectedVehicle
  ? telemetry.filter(
      (point) => point.vehicleId === selectedVehicle.vehicleId,
    ).length
  : 0

  const latestActivity = [...telemetry]
  .sort((a, b) => getTimestamp(b) - getTimestamp(a))
  .slice(0, 6)

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <h1 className="brand">
          Fleet<span>Dash</span>
        </h1>

        <nav className="navigation" aria-label="Main navigation">
          <a href="#overview" className="nav-link active">
            Overview
          </a>
          <a href="#fleet" className="nav-link">
            Live Fleet
          </a>
          <a href="#alerts" className="nav-link">
            Alerts
          </a>
        </nav>

        <div className="sidebar-footer">
          <span
            className={`status-dot ${connected ? '' : 'status-dot-offline'}`}
          />
          Backend connection
          <strong>{connected ? 'Connected' : 'Disconnected'}</strong>
        </div>
      </aside>

      <section className="main-content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">FLEET MANAGEMENT</p>
            <h2>Fleet Overview</h2>
          </div>

          <div className="system-status">
            <span
              className={`status-dot ${connected ? '' : 'status-dot-offline'}`}
            />
            {connected ? 'Live Connection' : 'Disconnected'}
          </div>
        </header>

        {error && (
          <div className="dashboard-error" role="alert">
            Telemetry connection error: {error}
          </div>
        )}

        <section className="summary-grid" aria-label="Fleet summary">
          <article className="summary-card">
            <p>Total Vehicles</p>
            <h3>{latestVehicles.length}</h3>
            <span>Unique vehicles received this session</span>
          </article>

          <article className="summary-card">
            <p>Active Vehicles</p>
            <h3>{activeVehicles.length}</h3>
            <span>Reported within the last 60 seconds</span>
          </article>

          <article className="summary-card">
            <p>Geofence Alerts</p>
<h3>{alerts.length}</h3>
<span>Geofence breach alerts received</span>
          </article>

          <article className="summary-card">
            <p>Telemetry Events</p>
            <h3>{telemetry.length}</h3>
<span>Historical and live events loaded</span>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel map-panel" id="fleet">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">FLEET LOCATION</p>
                <h3>Vehicle Coordinate View</h3>
              </div>
              <span className="panel-tag">
                {validLocations.length} locations
              </span>
            </div>

            <FleetMap
  vehicles={validLocations}
  selectedVehicleId={selectedVehicleId}
  onSelectVehicle={setSelectedVehicleId}
/>

            <p className="map-note">
  Live vehicle positions displayed on an interactive OpenStreetMap.
  Select a vehicle marker to view its coordinates.
</p>

            <div className="vehicle-list">
  {validLocations.map((vehicle) => {
    const isSelected = vehicle.vehicleId === selectedVehicleId

    const timestamp = getTimestamp(vehicle)
    const isActive =
      timestamp > 0 &&
      now - timestamp >= 0 &&
      now - timestamp <= ACTIVE_WINDOW_MS

    return (
      <div
        className={`vehicle-row ${isSelected ? 'selected' : ''}`}
        key={vehicle.vehicleId}
        onClick={() => setSelectedVehicleId(vehicle.vehicleId)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setSelectedVehicleId(vehicle.vehicleId)
          }
        }}
      >
        <div>
          <strong>{vehicle.vehicleId}</strong>
          <span>
            {vehicle.latitude.toFixed(4)},{' '}
            {vehicle.longitude.toFixed(4)}
          </span>
        </div>

        <span className="panel-tag">
          {isActive ? 'Active' : 'Stale'}
        </span>
      </div>
    )
    })}
</div>

<div className="vehicle-details">
  <h3>Selected Vehicle Details</h3>

  {selectedVehicle ? (
    <>
      <p>
        <strong>Vehicle ID:</strong> {selectedVehicle.vehicleId}
      </p>

      <p>
        <strong>Latitude:</strong> {selectedVehicle.latitude.toFixed(6)}
      </p>

      <p>
        <strong>Longitude:</strong> {selectedVehicle.longitude.toFixed(6)}
      </p>

      <p>
        <strong>Status:</strong> {selectedVehicleIsActive ? 'Active' : 'Stale'}
      </p>

      <p>
        <strong>Last Update:</strong>{' '}
        {selectedVehicleTimestamp > 0
          ? new Date(selectedVehicleTimestamp).toLocaleString()
          : 'Unavailable'}
      </p>

      <p>
        <strong>Telemetry Updates:</strong> {selectedVehicleUpdateCount}
      </p>
    </>
  ) : (
    <p>Select a vehicle to view its details.</p>
  )}
</div>

</article>

          <article className="panel activity-panel" id="alerts">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">MONITORING</p>
                <h3>Recent Fleet Activity</h3>
              </div>
              <span className="panel-tag">
                {connected ? 'Live' : 'Offline'}
              </span>
            </div>
            <div className="geofence-alert-section">
  <h4>Geofence Breach Alerts</h4>

  {alerts.length === 0 ? (
    <p className="alert-empty">
      No geofence breaches detected.
    </p>
  ) : (
    <div className="activity-list">
      {alerts.map((alert) => (
        <div className="activity-row" key={alert._id}>
          <span className="activity-indicator alert-indicator" />
          <div>
            <strong>{alert.vehicleId}</strong>
            <p>{alert.message}</p>
            <span>
              {alert.timestamp
                ? new Date(alert.timestamp).toLocaleString()
                : 'Timestamp unavailable'}
            </span>
          </div>
          <span className="panel-tag">Breach</span>
        </div>
      ))}
    </div>
  )}
</div>

            {latestActivity.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">↗</div>
                <h4>Waiting for telemetry</h4>
                <p>
                  {connectionStatus?.message ??
                    'The dashboard will display events when telemetry arrives.'}
                </p>
              </div>
            ) : (
              <div className="activity-list">
                {latestActivity.map((event, index) => (
                  <div
                    className="activity-row"
                    key={`${event.vehicleId}-${getTimestamp(event)}-${index}`}
                  >
                    <span className="activity-indicator" />
                    <div>
                      <strong>{event.vehicleId}</strong>
                      <p>
                        Location: {event.latitude.toFixed(4)},{' '}
                        {event.longitude.toFixed(4)}
                      </p>
                      <span>
                        {getTimestamp(event) > 0
                          ? new Date(getTimestamp(event)).toLocaleString()
                          : 'Timestamp unavailable'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <footer className="dashboard-footer">
          <span>FleetDash · Fleet telemetry monitoring</span>
          <span>Weeks 1–2 · Dashboard and Socket.IO integration</span>
        </footer>
      </section>
    </main>
  )
}

export default App
