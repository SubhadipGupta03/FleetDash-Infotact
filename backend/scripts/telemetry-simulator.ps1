
$ErrorActionPreference = "Stop"

$apiUrl = "https://fleetdash-backend-qgmh.onrender.com/api/telemetry/ingest"
$intervalSeconds = 3

$vehicles = @(
    @{
        id = "SIM-VEHICLE-001"
        latitude = 22.5726
        longitude = 88.3639
        step = 0.0005
        direction = 1
    },
    @{
        id = "SIM-VEHICLE-002"
        latitude = 22.5750
        longitude = 88.3680
        step = 0.0004
        direction = -1
    }
)

Write-Host "FleetDash Telemetry Simulator started." -ForegroundColor Green
Write-Host "Sending updates every $intervalSeconds seconds."
Write-Host "Press Ctrl+C to stop."
Write-Host ""

try {
    while ($true) {
        foreach ($vehicle in $vehicles) {
            $vehicle.latitude += $vehicle.step * $vehicle.direction
            $vehicle.longitude += $vehicle.step * $vehicle.direction

            $eventId = [guid]::NewGuid().ToString()

            $body = @{
                eventId = $eventId
                vehicleId = $vehicle.id
                latitude = [math]::Round($vehicle.latitude, 6)
                longitude = [math]::Round($vehicle.longitude, 6)
                timestamp = (Get-Date).ToUniversalTime().ToString("o")
            } | ConvertTo-Json

            try {
                $response = Invoke-RestMethod `
                    -Uri $apiUrl `
                    -Method Post `
                    -ContentType "application/json" `
                    -Body $body

                if ($response.success) {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $($vehicle.id) | $($vehicle.latitude), $($vehicle.longitude) | Stored" -ForegroundColor Green
                }
                else {
                    Write-Host "API rejected update for $($vehicle.id)" -ForegroundColor Yellow
                }
            }
            catch {
                Write-Host "Failed to send $($vehicle.id): $($_.Exception.Message)" -ForegroundColor Red
            }
        }

        Start-Sleep -Seconds $intervalSeconds
    }
}
finally {
    Write-Host "`nFleetDash Telemetry Simulator stopped." -ForegroundColor Yellow
}