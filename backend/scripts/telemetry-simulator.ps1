
$ErrorActionPreference = "Stop"

$apiUrl = "http://localhost:5000/api/telemetry/ingest"
$intervalSeconds = 3

$vehicles = @(
    @{ id = "SIM-VEHICLE-001"; latitude = 28.6139; longitude = 77.2090; step = 0.0005; direction = 1 },
    @{ id = "SIM-VEHICLE-002"; latitude = 19.0760; longitude = 72.8777; step = 0.0004; direction = -1 },
    @{ id = "SIM-VEHICLE-003"; latitude = 12.9716; longitude = 77.5946; step = 0.0003; direction = 1 },
    @{ id = "SIM-VEHICLE-004"; latitude = 13.0827; longitude = 80.2707; step = 0.0004; direction = -1 },
    @{ id = "SIM-VEHICLE-005"; latitude = 22.5726; longitude = 88.3639; step = 0.0003; direction = 1 },
    @{ id = "SIM-VEHICLE-006"; latitude = 17.3850; longitude = 78.4867; step = 0.0004; direction = -1 },
    @{ id = "SIM-VEHICLE-007"; latitude = 23.0225; longitude = 72.5714; step = 0.0003; direction = 1 },
    @{ id = "SIM-VEHICLE-008"; latitude = 26.9124; longitude = 75.7873; step = 0.0004; direction = -1 },
    @{ id = "SIM-VEHICLE-009"; latitude = 18.5204; longitude = 73.8567; step = 0.0003; direction = 1 },
    @{ id = "SIM-VEHICLE-010"; latitude = 21.1458; longitude = 79.0882; step = 0.0004; direction = -1 }
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