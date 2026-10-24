
import './App.css'
import { useTelemetry } from './hooks/useTelemetry'

function App() {
  const { connected, connectionStatus, telemetry, error } = useTelemetry()

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <h1 className="brand">Fleet<span>Dash</span></h1>

        <nav className="navigation" aria-label="Main navigation">
          <a href="#overview" className="nav-link active">Overview</a>
          <a href="#fleet" className="nav-link">Live Fleet</a>
          <a href="#alerts" className="nav-link">Alerts</a>
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
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
            <span className="status-dot" />
            {connected ? 'Live Connection' : 'Connecting...'}
          </div>
        </header>

        <section className="summary-grid" aria-label="Fleet summary">
          <article className="summary-card">
            <p>Total Vehicles</p>
            <h3>--</h3>
            <span>Fleet size</span>
          </article>

          <article className="summary-card">
            <p>Active Vehicles</p>
            <h3>--</h3>
            <span>Currently reporting</span>
          </article>

          <article className="summary-card">
            <p>Pending Alerts</p>
            <h3>--</h3>
            <span>Requires attention</span>
          </article>

          <article className="summary-card">
            <p>Telemetry Events</p>
            <h3>{telemetry.length}</h3>
            <span>Events received by this session</span>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel map-panel" id="fleet">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">FLEET LOCATION</p>
                <h3>Vehicle Map</h3>
              </div>
              <span className="panel-tag">Preview</span>
            </div>

            <div className="map-placeholder" role="img" aria-label="Placeholder for the fleet vehicle map">
              <div className="map-grid" />
              <div className="map-message">
                <span className="map-pin">⌖</span>
                <h4>Fleet map goes here</h4>
                <p>Vehicle locations will appear when the map layer is implemented.</p>
              </div>
            </div>
          </article>

          <article className="panel activity-panel" id="alerts">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">MONITORING</p>
                <h3>Fleet Activity</h3>
              </div>
              <span className="panel-tag">Live feed preparation</span>
            </div>

            <div className="empty-state">
              <div className="empty-icon">↗</div>
              <h4>{telemetry.length > 0 ? 'Telemetry received' : 'Waiting for telemetry'}</h4>
              <p>
                {connectionStatus?.message ??
                  'The dashboard is waiting for the backend connection status.'}
              </p>
              {error && <p role="alert">Connection or telemetry error: {error}</p>}
            </div>
          </article>
        </section>

        <footer className="dashboard-footer">
          FleetDash · Fleet telemetry monitoring
          <span>Weeks 1–2 · Dashboard and Socket.IO integration</span>
        </footer>
      </section>
    </main>
  )
}

export default App
