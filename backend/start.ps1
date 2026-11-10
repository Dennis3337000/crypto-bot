$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath
Write-Host "Starte CryptoAnalyzer Backend auf Port 8001 (IPv4 & IPv6)..."
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8001
