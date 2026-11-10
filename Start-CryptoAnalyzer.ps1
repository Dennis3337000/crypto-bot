$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

Write-Host "Raeume alte Prozesse auf Port 5174 und 8001 auf..."
$oldPorts = @(5174, 8001)
foreach ($port in $oldPorts) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            if ($conn.OwningProcess -gt 0) {
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
Start-Sleep -Milliseconds 800

Write-Host "Starte CryptoAnalyzer Backend (FastAPI auf Port 8001)..."
Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -NoProfile -File backend/start.ps1" -WindowStyle Hidden

Write-Host "Starte CryptoAnalyzer Frontend (Vite auf Port 5174)..."
Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -NoProfile -File frontend/start.ps1" -WindowStyle Hidden

Start-Sleep -Seconds 3

Write-Host "Oeffne Krypto-Trading Dashboard im Browser (High-Speed IPv4)..."
Start-Process "http://127.0.0.1:5174"

Write-Host "CryptoAnalyzer erfolgreich gestartet!"
