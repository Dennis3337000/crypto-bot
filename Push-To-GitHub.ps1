param(
    [Parameter(Mandatory=$true)]
    [string]$RepoUrl
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

Write-Host "Initialisiere Git Repository..."
if (-not (Test-Path ".git")) {
    git init
    git branch -M main
}

Write-Host "Fuege Dateien hinzu (geschuetzte .env Keys werden durch .gitignore ignoriert)..."
git add .
git commit -m "Initial commit: 24/7 CryptoAnalyzer Bot ready for Render"

Write-Host "Setze Remote Origin auf $RepoUrl..."
git remote remove origin 2>$null
git remote add origin $RepoUrl

Write-Host "Pushe auf GitHub main branch..."
git push -u origin main

Write-Host "Erfolgreich auf GitHub gepusht! Jetzt auf Render.com verbinden."
