
$ErrorActionPreference = "Stop"

Write-Host "`nStarting FleetDash Redis Cluster in Ubuntu..." -ForegroundColor Cyan

$bashCommand = @'
for port in 7001 7002 7003; do
    if redis-cli -h 127.0.0.1 -p "$port" ping 2>/dev/null | grep -q PONG; then
        echo "Redis $port is already running."
    else
        echo "Starting Redis $port..."
        redis-server "$HOME/fleetdash-redis/$port/redis.conf" || exit 1
    fi
done

for port in 7001 7002 7003; do
    ready=0
    for attempt in $(seq 1 20); do
        if redis-cli -h 127.0.0.1 -p "$port" ping 2>/dev/null | grep -q PONG; then
            ready=1
            break
        fi
        sleep 1
    done

    if [ "$ready" -ne 1 ]; then
        echo "ERROR: Redis $port did not become ready."
        exit 1
    fi

    echo "Redis $port is ready."
done
'@

$bashCommand = $bashCommand -replace "`r`n", "`n" -replace "`r", ""

$encodedCommand = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes($bashCommand)
)

& wsl.exe -- bash -lc "echo $encodedCommand | base64 -d | bash"

if ($LASTEXITCODE -ne 0) {
    throw "Redis Cluster startup failed. FleetDash backend will not start."
}

Write-Host "`nAll Redis nodes are ready." -ForegroundColor Green
