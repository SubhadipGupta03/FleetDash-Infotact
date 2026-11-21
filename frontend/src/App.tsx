
import FleetMap from './components/FleetMap'
import './App.css'
import { useEffect, useMemo, useState } from 'react'
import { useTelemetry } from './hooks/useTelemetry'
import type { TelemetryPoint } from './services/socket'
import { getLatestPositions } from './services/telemetryStore'

const ACTIVE_WINDOW_MS = 60_000

type Section = 'overview' | 'fleet' | 'alerts' | 'analytics' | 'reports' | 'settings'

const navigation: { id: Section; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '▦' },
  { id: 'fleet', label: 'Live Fleet', icon: '▣' },
  { id: 'alerts', label: 'Alerts', icon: '♧' },
  { id: 'analytics', label: 'Analytics', icon: '▥' },
  { id: 'reports', label: 'Reports', icon: '▤' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

function getTimestamp(point: TelemetryPoint): number {
  if (point.timestamp === undefined) return 0

  const value =
    typeof point.timestamp === 'number'
      ? point.timestamp
      : Date.parse(point.timestamp)

  if (!Number.isFinite(value)) return 0
  return value < 1e12 ? value * 1000 : value
}

function formatTime(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleString() : 'Unavailable'
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
    )
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function App() {
  const [now, setNow] = useState(Date.now())
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<Section>('overview')
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('All')
  const [analyticsWindow, setAnalyticsWindow] = useState('24h')

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

 const {
  connected,
  connectionStatus,
  telemetry,
  alerts,
  error,
  historyStatus,
} = useTelemetry()

  const latestVehicles = Array.from(getLatestPositions().values()).sort(
    (a, b) => a.vehicleId.localeCompare(b.vehicleId),
  )

  const activeVehicles = useMemo(
    () =>
      latestVehicles.filter((vehicle) => {
        const timestamp = getTimestamp(vehicle)
        const age = now - timestamp
        return timestamp > 0 && age >= 0 && age <= ACTIVE_WINDOW_MS
      }),
    [latestVehicles, now],
  )

  const validLocations = useMemo(
    () =>
      latestVehicles.filter(
        (vehicle) =>
          Number.isFinite(vehicle.latitude) &&
          Number.isFinite(vehicle.longitude) &&
          vehicle.latitude >= -90 &&
          vehicle.latitude <= 90 &&
          vehicle.longitude >= -180 &&
          vehicle.longitude <= 180,
      ),
    [latestVehicles],
  )

  const selectedVehicle = validLocations.find(
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
    ? telemetry.filter((point) => point.vehicleId === selectedVehicle.vehicleId).length
    : 0

  const latestActivity = useMemo(
    () =>
      [...telemetry]
        .sort((a, b) => getTimestamp(b) - getTimestamp(a))
        .slice(0, 8),
    [telemetry],
  )

  const filteredVehicles = useMemo(() => {
    const search = vehicleSearch.trim().toLowerCase()

    return validLocations.filter((vehicle) => {
      const timestamp = getTimestamp(vehicle)
      const isActive =
        timestamp > 0 &&
        now - timestamp >= 0 &&
        now - timestamp <= ACTIVE_WINDOW_MS

      const matchesSearch = vehicle.vehicleId.toLowerCase().includes(search)
      const matchesFilter =
        vehicleFilter === 'All' ||
        (vehicleFilter === 'Active' && isActive) ||
        (vehicleFilter === 'Stale' && !isActive)

      return matchesSearch && matchesFilter
    })
  }, [validLocations, vehicleSearch, vehicleFilter, now])


  const analyticsData = useMemo(() => {
    const dayCount =
      analyticsWindow === '24h' ? 1 :
      analyticsWindow === '7d' ? 7 : 30

    const bucketCount = analyticsWindow === '24h' ? 24 : dayCount
    const bucketSize = analyticsWindow === '24h'
      ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000

    const start = now - bucketCount * bucketSize
    const counts = Array.from({ length: bucketCount }, () => 0)

    telemetry.forEach((point) => {
      const timestamp = getTimestamp(point)

      if (timestamp < start || timestamp > now) return

      const index = Math.min(
        bucketCount - 1,
        Math.floor((timestamp - start) / bucketSize),
      )

      if (index >= 0) counts[index] += 1
    })

    return counts
  }, [telemetry, now, analyticsWindow])


  const maxAnalyticsValue = Math.max(1, ...analyticsData)
  const activeValidVehicles = validLocations.filter((vehicle) => {
  const timestamp = getTimestamp(vehicle)
  const age = now - timestamp

  return timestamp > 0 && age >= 0 && age <= ACTIVE_WINDOW_MS
})

const activePercentage =
  validLocations.length > 0
    ? Math.round((activeValidVehicles.length / validLocations.length) * 100)
    : 0

  function exportVehicles() {
    downloadCsv('fleetdash-vehicles.csv', [
      ['Vehicle ID', 'Status', 'Latitude', 'Longitude', 'Last Update'],
      ...validLocations.map((vehicle) => {
        const timestamp = getTimestamp(vehicle)
        const isActive =
          timestamp > 0 &&
          now - timestamp >= 0 &&
          now - timestamp <= ACTIVE_WINDOW_MS

        return [
          vehicle.vehicleId,
          isActive ? 'Active' : 'Stale',
          String(vehicle.latitude),
          String(vehicle.longitude),
          formatTime(timestamp),
        ]
      }),
    ])
  }

  function exportAlerts() {
    downloadCsv('fleetdash-alerts.csv', [
      ['Vehicle ID', 'Geofence', 'Message', 'Timestamp'],
      ...alerts.map((alert) => [
        alert.vehicleId,
        alert.geofenceName,
        alert.message,
        alert.timestamp,
      ]),
    ])
  }

  function renderVehicleTable() {
    return (
      <>
        <div className="table-toolbar">
          <label className="vehicle-search">
            <span>⌕</span>
            <input
              value={vehicleSearch}
              onChange={(event) => setVehicleSearch(event.target.value)}
              placeholder="Search vehicle..."
              aria-label="Search vehicles"
            />
          </label>

          <div className="filter-tabs" aria-label="Filter vehicles">
            {['All', 'Active', 'Stale'].map((filter) => (
              <button
                type="button"
                key={filter}
                className={vehicleFilter === filter ? 'filter-tab active' : 'filter-tab'}
                onClick={() => setVehicleFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="table-scroll">
          <table className="fleet-table">
            <thead>
              <tr>
                <th>Vehicle ID</th>
                <th>Status</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Last Update</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.map((vehicle) => {
                const timestamp = getTimestamp(vehicle)
                const isActive =
                  timestamp > 0 &&
                  now - timestamp >= 0 &&
                  now - timestamp <= ACTIVE_WINDOW_MS

                return (
                  <tr key={vehicle.vehicleId}>
                    <td>{vehicle.vehicleId}</td>
                    <td>
                      <span className={`status-label ${isActive ? 'is-active' : 'is-stale'}`}>
                        {isActive ? 'Active' : 'Stale'}
                      </span>
                    </td>
                    <td>{vehicle.latitude.toFixed(5)}</td>
                    <td>{vehicle.longitude.toFixed(5)}</td>

                    <td>
                      <button
                        className="table-action"
                        type="button"
                        onClick={() => {
                          setSelectedVehicleId(vehicle.vehicleId)
                          setActiveSection('fleet')
                        }}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filteredVehicles.length === 0 && (
  <tr>
    <td colSpan={6} className="table-empty">
      {historyStatus === 'unavailable' && !connected
        ? 'Vehicle data unavailable. Waiting for backend connection.'
        : validLocations.length === 0
          ? 'No vehicles available yet. Waiting for telemetry data.'
          : 'No vehicles match this filter.'}
    </td>
  </tr>
)}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  function renderAlerts() {
    return (
      <div className="alert-page-list">
        {alerts.length === 0 ? (
          <div className="empty-state compact-empty">
            <div className="empty-icon">♧</div>
            <h4>
  {historyStatus === 'unavailable' && !connected
    ? 'Alerts unavailable'
    : 'No recent alerts'}
</h4>
            <p>Geofence breach alerts will appear here when received.</p>
          </div>
        ) : (
          alerts.map((alert) => (
            <article className="alert-card" key={alert._id}>
              <span className="activity-indicator alert-indicator" />
              <div>
                <strong>{alert.vehicleId}</strong>
                <p>{alert.message}</p>
                <span>{alert.geofenceName} · {formatTime(Date.parse(alert.timestamp))}</span>
              </div>
              <span className="alert-severity">Breach</span>
            </article>
          ))
        )}
      </div>
    )
  }

  function renderAnalytics() {
    return (
      <>
        <div className="analytics-summary">
          <article className="mini-stat">
            <span>Total telemetry events</span>
            <strong>{telemetry.length}</strong>
          </article>
          <article className="mini-stat">
            <span>Vehicles reporting</span>
            <strong>{validLocations.length}</strong>
          </article>
          <article className="mini-stat">
            <span>Geofence alerts</span>
            <strong>{alerts.length}</strong>
          </article>
        </div>

        <article className="panel analytics-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">TELEMETRY TRENDS</p>
              <h3>Telemetry Events</h3>
            </div>
            <select
              className="period-select"
              value={analyticsWindow}
              onChange={(event) => setAnalyticsWindow(event.target.value)}
              aria-label="Analytics time window"
            >
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </div>

          <div
  className="chart-area"
  role="img"
  aria-label="Telemetry events grouped by time interval"
>
  {analyticsData.every((value) => value === 0) ? (
    <div className="empty-state compact-empty">
      <h4>No telemetry data available</h4>
      <p>Telemetry events will appear here when data is received.</p>
    </div>
  ) : (
    analyticsData.map((value, index) => (
      <div className="chart-column" key={index}>
        <span className="chart-value">{value || ''}</span>
        <div
          className="chart-bar"
          style={{
            height: `${Math.max(
              value > 0 ? 5 : 1,
              (value / maxAnalyticsValue) * 100,
            )}%`,
          }}
          title={`${value} events`}
        />
        <span className="chart-label">
          {analyticsWindow === '24h'
            ? `${index}:00`
            : analyticsWindow === '30d' &&
                index % 5 !== 0 &&
                index !== analyticsData.length - 1
              ? ''
              : new Date(
                  now -
                    analyticsData.length * 24 * 60 * 60 * 1000 +
                    index * 24 * 60 * 60 * 1000,
                ).toLocaleDateString('en-IN', {
                  month: 'short',
                  day: 'numeric',
                })}
        </span>
      </div>
    ))
  )}
</div>
          <p className="chart-note">Counts are calculated from telemetry events currently loaded by the dashboard.</p>
        </article>
      </>
    )
  }

  function renderOverview() {
    return (
      <>
        <section className="summary-grid" aria-label="Fleet summary">
  <article className="summary-card kpi-vehicles">
    <div className="kpi-icon">▣</div>
    <p>Total Vehicles</p>
    <h3>
      {historyStatus === 'unavailable' && !connected
        ? '—'
        : latestVehicles.length}
    </h3>
    <span>Unique vehicles received</span>
  </article>

  <article className="summary-card kpi-active">
    <div className="kpi-icon">▶</div>
    <p>Active Vehicles</p>
    <h3>
      {historyStatus === 'unavailable' && !connected
        ? '—'
        : activeVehicles.length}
    </h3>
    <span>Updated within 60 seconds</span>
  </article>

  <article className="summary-card kpi-alerts">
    <div className="kpi-icon">!</div>
    <p>Geofence Alerts</p>
    <h3>
      {historyStatus === 'unavailable' && !connected
        ? '—'
        : alerts.length}
    </h3>
    <span>Alerts received</span>
  </article>

  <article className="summary-card kpi-events">
    <div className="kpi-icon">▥</div>
    <p>Telemetry Events</p>
    <h3>
      {historyStatus === 'unavailable' && !connected
        ? '—'
        : telemetry.length}
    </h3>
    <span>Loaded live and historical events</span>
  </article>
</section>

        <section className="overview-top-grid">
          <article className="panel map-panel" id="fleet-map">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">LIVE LOCATION</p>
                <h3>⌖ Live Fleet Map</h3>
              </div>
              <span
  className={`live-pill ${
    !connected
      ? 'offline-pill'
      : activeVehicles.length > 0
        ? 'telemetry-active'
        : 'telemetry-idle'
  }`}
>
  {!connected
    ? '● Backend Disconnected'
    : activeVehicles.length > 0
      ? '● Telemetry Active'
      : '● No Active Telemetry'}
</span>
            </div>
            <FleetMap
              vehicles={validLocations}
              selectedVehicleId={selectedVehicleId}
              onSelectVehicle={setSelectedVehicleId}
            />
            <div className="map-legend">
              <span><i className="legend-dot active-dot" /> Active</span>
              <span><i className="legend-dot stale-dot" /> Stale</span>
              <span className="map-count">{validLocations.length} locations</span>
            </div>
          </article>

          <div className="overview-side-column">
  <article className="panel health-panel">
    <div className="panel-heading">
      <h3>⌁ Fleet Health</h3>
      <span className="health-percent">
        {historyStatus === 'unavailable' && !connected
          ? '—'
          : `${activePercentage}% active`}
      </span>
    </div>

    <div className="health-content">
      <div
        className="health-ring"
        style={{
          '--health-value': `${
            historyStatus === 'unavailable' && !connected
              ? 0
              : activePercentage
          }%`,
        } as React.CSSProperties}
      >
        <strong>
          {historyStatus === 'unavailable' && !connected
            ? '—'
            : `${activePercentage}%`}
        </strong>
      </div>

      <div className="health-legend">
        <span>
          <i className="legend-dot active-dot" /> Active
          <b>
            {historyStatus === 'unavailable' && !connected
              ? '—'
             : activeValidVehicles.length}
          </b>
        </span>

        <span>
          <i className="legend-dot stale-dot" /> Stale
          <b>
            {historyStatus === 'unavailable' && !connected
              ? '—'
              : validLocations.length - activeValidVehicles.length}
          </b>
        </span>
      </div>
    </div>

    <div className="health-footer">
      {connected
        ? '● Backend connected'
        : '● Waiting for backend connection'}
    </div>
  </article>

            <article className="panel recent-alerts-panel">
              <div className="panel-heading">
                <h3>♧ Recent Alerts</h3>
                <button className="text-action" onClick={() => setActiveSection('alerts')} type="button">
                  View All →
                </button>
              </div>
              {alerts.length === 0 ? (
                <p className="muted-message">
  {historyStatus === 'unavailable' && !connected
    ? 'Alerts unavailable. Waiting for backend connection.'
    : 'No recent alerts'}
</p>
              ) : (
                alerts.slice(0, 3).map((alert) => (
                  <div className="recent-alert-row" key={alert._id}>
                    <i className="legend-dot alert-dot" />
                    <div><strong>{alert.vehicleId}</strong><span>{alert.message}</span></div>
                  </div>
                ))
              )}
            </article>
          </div>
        </section>

        <section className="overview-bottom-grid">
          <article className="panel fleet-table-panel">
            <div className="panel-heading">
              <h3>▣ Fleet Overview</h3>
              <button className="text-action" onClick={() => setActiveSection('fleet')} type="button">
                View Fleet →
              </button>
            </div>
            {renderVehicleTable()}
          </article>

          <article className="panel timeline-panel">
            <div className="panel-heading">
              <h3>ϟ Fleet Activity</h3>
              <span
  className={`live-pill ${
    !connected
      ? 'offline-pill'
      : activeVehicles.length > 0
        ? 'telemetry-active'
        : 'telemetry-idle'
  }`}
>
  {!connected
    ? '● Backend Disconnected'
    : activeVehicles.length > 0
      ? '● Telemetry Active'
      : '● No Active Telemetry'}
</span>
            </div>
            {latestActivity.length === 0 ? (
              <p className="muted-message">
  {historyStatus === 'unavailable' && !connected
    ? 'Telemetry activity unavailable. Waiting for backend connection.'
    : 'No telemetry activity yet. Waiting for telemetry data.'}
</p>
            ) : (
              <div className="timeline-list">
                {latestActivity.slice(0, 5).map((event, index) => (
                  <div className="timeline-item" key={`${event.vehicleId}-${getTimestamp(event)}-${index}`}>
                    <i />
                    <div>
                      <strong>{event.vehicleId}</strong>
                      <p>Location updated · {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}</p>
                      <span>{formatTime(getTimestamp(event))}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="panel mini-analytics-panel">
            <div className="panel-heading">
              <h3>▥ Fleet Analytics</h3>
              <button className="text-action" onClick={() => setActiveSection('analytics')} type="button">
                Details →
              </button>
            </div>
            <div className="mini-chart">
              {analyticsData.slice(0, 12).map((value, index) => (
                <div key={index} title={`${value} events`} style={{ height: `${Math.max(4, (value / maxAnalyticsValue) * 100)}%` }} />
              ))}
            </div>
            <p className="chart-note">{telemetry.length} loaded telemetry events</p>
          </article>
        </section>
      </>
    )
  }

  const pageTitles: Record<Section, { eyebrow: string; title: string; subtitle: string }> = {
    overview: { eyebrow: 'FLEET MANAGEMENT', title: 'Fleet Overview', subtitle: 'Real-time fleet monitoring and insights' },
    fleet: { eyebrow: 'VEHICLE MANAGEMENT', title: 'Live Fleet', subtitle: 'Vehicle locations and latest reported status' },
    alerts: { eyebrow: 'MONITORING CENTER', title: 'Geofence Alerts', subtitle: 'Review detected geofence breach events' },
    analytics: { eyebrow: 'FLEET INTELLIGENCE', title: 'Analytics', subtitle: 'Telemetry activity based on received events' },
    reports: { eyebrow: 'DATA EXPORT', title: 'Reports', subtitle: 'Export the fleet and alert data currently available' },
    settings: { eyebrow: 'CONFIGURATION', title: 'Settings', subtitle: 'Current dashboard and connection information' },
  }

  const page = pageTitles[activeSection]

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">F</span>
          <div><strong>FleetDash</strong><small>Track. Monitor. Optimize.</small></div>
        </div>

        <nav className="navigation" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-link ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => {
                setActiveSection(item.id)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              aria-current={activeSection === item.id ? 'page' : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'alerts' && alerts.length > 0 && (
                <span className="nav-badge">{alerts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-connection">
          <span className={`status-dot ${connected ? '' : 'status-dot-offline'}`} />
          <div>
            <strong>Backend {connected ? 'Connected' : 'Disconnected'}</strong>
            <small>{connectionStatus?.message ?? (connected ? 'Live connection' : 'Waiting for connection')}</small>
          </div>
        </div>
        <small className="sidebar-version">FleetDash · Telemetry monitoring</small>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div className="page-heading">
            <p className="eyebrow">{page.eyebrow}</p>
            <h1>{page.title}</h1>
            <p className="page-subtitle">{page.subtitle}</p>
          </div>
          <div className="topbar-actions">
           <span
  className={`connection-pill ${
    !connected
      ? 'disconnected'
      : activeVehicles.length > 0
        ? 'connected'
        : 'telemetry-idle'
  }`}
>
  <i />
  {!connected
    ? 'Backend Disconnected'
    : activeVehicles.length > 0
      ? 'Telemetry Active'
      : 'No Active Telemetry'}
</span>
            <span className="updated-time">Updated: {new Date(now).toLocaleTimeString()}</span>
            <span className="user-avatar" aria-label="FleetDash">FD</span>
          </div>
        </header>

        {error && (
          <div className="dashboard-error" role="alert">
            Telemetry connection error: {error}
          </div>
        )}

        {activeSection === 'overview' && renderOverview()}

        {activeSection === 'fleet' && (
          <div className="page-stack">
            <article className="panel full-map-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">REAL-TIME TRACKING</p><h3>Live Vehicle Map</h3></div>
                <span className="live-pill">{validLocations.length} locations</span>
              </div>
              <FleetMap vehicles={validLocations} selectedVehicleId={selectedVehicleId} onSelectVehicle={setSelectedVehicleId} />
              {selectedVehicle && (
                <div className="selected-vehicle-strip">
                  <strong>{selectedVehicle.vehicleId}</strong>
                  <span>{selectedVehicle.latitude.toFixed(5)}, {selectedVehicle.longitude.toFixed(5)}</span>
                  <span>{selectedVehicleIsActive ? 'Active' : 'Stale'}</span>
                  <span>{selectedVehicleUpdateCount} loaded updates</span>
                </div>
              )}
            </article>
            <article className="panel fleet-table-panel">
              <div className="panel-heading"><h3>All Vehicles</h3><span className="panel-tag">{validLocations.length} vehicles</span></div>
              {renderVehicleTable()}
            </article>
          </div>
        )}

        {activeSection === 'alerts' && (
          <div className="page-stack">
            <div className="analytics-summary">
              <article className="mini-stat"><span>Total alerts received</span><strong>{alerts.length}</strong></article>
              <article className="mini-stat"><span>Alert source</span><strong>Geofence</strong></article>
              <article className="mini-stat"><span>Connection</span><strong>{connected ? 'Live' : 'Offline'}</strong></article>
            </div>
            <article className="panel">
              <div className="panel-heading"><h3>All Geofence Alerts</h3><span className="panel-tag">{alerts.length} received</span></div>
              {renderAlerts()}
            </article>
          </div>
        )}

        {activeSection === 'analytics' && (
          <div className="page-stack">
            {renderAnalytics()}
          </div>
        )}

        {activeSection === 'reports' && (
          <div className="page-stack">
            <div className="analytics-summary">
              <article className="mini-stat"><span>Vehicle records</span><strong>{validLocations.length}</strong></article>
              <article className="mini-stat"><span>Telemetry events loaded</span><strong>{telemetry.length}</strong></article>
              <article className="mini-stat"><span>Geofence alerts loaded</span><strong>{alerts.length}</strong></article>
            </div>
            <article className="panel reports-panel">
              <div className="panel-heading"><h3>Export Data</h3><span className="panel-tag">CSV format</span></div>
              <p className="page-description">Download the records currently available in this dashboard. Exports contain actual received data only.</p>
              <div className="report-actions">
                <div><strong>Fleet vehicle report</strong><span>Vehicle ID, status, coordinates and last update</span><button type="button" onClick={exportVehicles}>Download vehicles CSV ↓</button></div>
                <div><strong>Geofence alert report</strong><span>Vehicle, geofence, alert message and timestamp</span><button type="button" onClick={exportAlerts}>Download alerts CSV ↓</button></div>
              </div>
            </article>
          </div>
        )}

        {activeSection === 'settings' && (
          <div className="page-stack">
            <article className="panel settings-panel">
              <div className="panel-heading"><h3>Connection Status</h3><span className={`live-pill ${connected ? '' : 'offline-pill'}`}>{connected ? 'Connected' : 'Disconnected'}</span></div>
              <div className="settings-row"><div><strong>Telemetry backend</strong><span>Socket connection status</span></div><b>{connected ? 'Online' : 'Offline'}</b></div>
              <div className="settings-row"><div><strong>Connection message</strong><span>{connectionStatus?.message ?? 'No additional connection message'}</span></div></div>
              <div className="settings-row"><div><strong>Refresh behavior</strong><span>Vehicle active status is evaluated every second</span></div><b>Enabled</b></div>
              <div className="settings-row"><div><strong>Active vehicle window</strong><span>Vehicles are considered active when updated within</span></div><b>60 seconds</b></div>
            </article>
            <article className="panel settings-panel">
              <div className="panel-heading"><h3>Dashboard Information</h3></div>
              <div className="settings-row"><div><strong>Application</strong><span>FleetDash telemetry dashboard</span></div></div>
              <div className="settings-row"><div><strong>Map provider</strong><span>OpenStreetMap through Leaflet</span></div></div>
              <div className="settings-row"><div><strong>Data source</strong><span>Backend telemetry and geofence alert events</span></div></div>
            </article>
          </div>
        )}

        <footer className="dashboard-footer">
          <span>FleetDash · Fleet telemetry monitoring</span>
          <span className={connected ? 'footer-connected' : 'footer-disconnected'}>
            <i /> {connected ? 'Live Connection' : 'Disconnected'}
          </span>
          <span>Weeks 1–2 · Dashboard and Socket.IO integration</span>
        </footer>
      </section>
    </main>
  )
}

export default App
