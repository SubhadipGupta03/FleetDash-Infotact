
import './App.css'
import { useMemo } from 'react'
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
  const { connected, connectionStatus, telemetry, error } = useTelemetry()

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
    const age = Date.now() - timestamp

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

  const minLatitude = Math.min(
    ...validLocations.map((vehicle) => vehicle.latitude),
  )
  const maxLatitude = Math.max(
    ...validLocations.map((vehicle) => vehicle.latitude),
  )
  const minLongitude = Math.min(
    ...validLocations.map((vehicle) => vehicle.longitude),
  )
  const maxLongitude = Math.max(
    ...validLocations.map((vehicle) => vehicle.longitude),
  )

  function getPosition(vehicle: TelemetryPoint) {
    const latitudeRange = maxLatitude - minLatitude
    const longitudeRange = maxLongitude - minLongitude

    const x =
      longitudeRange === 0
        ? 50
        : 8 + ((vehicle.longitude - minLongitude) / longitudeRange) * 84

    const y =
      latitudeRange === 0
        ? 50
        : 92 - ((vehicle.latitude - minLatitude) / latitudeRange) * 84

    return { left: `${x}%`, top: `${y}%` }
  }

  const latestActivity = [...telemetry].reverse().slice(0, 6)

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
            <p>Pending Alerts</p>
            <h3>—</h3>
            <span>Alert data source not connected</span>
          </article>

          <article className="summary-card">
            <p>Telemetry Events</p>
            <h3>{telemetry.length}</h3>
            <span>Events received this session</span>
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

            <div
              className="live-map"
              role="img"
              aria-label={`Coordinate plot showing ${validLocations.length} vehicle locations`}
            >
              <div className="map-grid" />

              {validLocations.length === 0 ? (
                <div className="map-message">
                  <span className="map-pin">◎</span>
                  <h4>Waiting for vehicle locations</h4>
                  <p>
                    Valid latitude and longitude coordinates will appear here
                    when telemetry arrives.
                  </p>
                </div>
              ) : (
                validLocations.map((vehicle) => (
                  <div
                    key={vehicle.vehicleId}
                    className="vehicle-marker"
                    style={getPosition(vehicle)}
                    title={`${vehicle.vehicleId}: ${vehicle.latitude}, ${vehicle.longitude}`}
                  >
                    <span className="vehicle-marker-dot" />
                    <span className="vehicle-marker-label">
                      {vehicle.vehicleId}
                    </span>
                  </div>
                ))
              )}
            </div>

            <p className="map-note">
              Coordinate plot, not a geographic street map. Positions are
              relative to the received coordinates.
            </p>

            <div className="vehicle-list">
              {validLocations.map((vehicle) => (
                <div className="vehicle-row" key={vehicle.vehicleId}>
                  <div>
                    <strong>{vehicle.vehicleId}</strong>
                    <span>
                      {vehicle.latitude.toFixed(4)},{' '}
                      {vehicle.longitude.toFixed(4)}
                    </span>
                  </div>
                  <span className="panel-tag">
                    {getTimestamp(vehicle) > 0 &&
                    Date.now() - getTimestamp(vehicle) >= 0 &&
                    Date.now() - getTimestamp(vehicle) <= ACTIVE_WINDOW_MS
                      ? 'Active'
                      : 'Stale'}
                  </span>
                </div>
              ))}
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
