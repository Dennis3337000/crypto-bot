$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

if (-not (Test-Path "node_modules")) {
    Write-Host "Installiere Node-Abhaengigkeiten..."
    npm install
}

Write-Host "Starte Vite Frontend Dev Server auf Port 5174 (IPv4 & IPv6)..."
npx vite --host 0.0.0.0 --port 5174
