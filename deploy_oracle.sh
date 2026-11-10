#!/bin/bash
# ==============================================================================
# CryptoAnalyzer - Oracle Cloud Always Free 24/7 Deployment Script
# Automatisches Setup fuer Ubuntu 22.04 / 24.04 LTS
# ==============================================================================

set -e

echo "=== [1/6] System-Pakete aktualisieren ==="
sudo apt-get update -y
sudo apt-get install -y python3 python3-pip python3-venv curl git ufw iptables-persistent

echo "=== [2/6] Node.js (LTS) installieren fuer das Frontend ==="
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "Node Version: $(node -v)"
echo "NPM Version: $(npm -v)"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "=== [3/6] Python Virtual Environment fuer Backend aufsetzen ==="
cd "$APP_DIR/backend"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Sicherstellen, dass .env existiert
if [ ! -f ".env" ]; then
    echo "ACHTUNG: Bitte erstelle backend/.env mit deinen Binance Testnet Keys!"
    if [ -f ".env.example" ]; then
        cp .env.example .env
    fi
fi

echo "=== [4/6] Frontend bauen ==="
cd "$APP_DIR/frontend"
npm install
npm run build

echo "=== [5/6] Oracle Cloud Firewall (iptables & ufw) konfigurieren ==="
# Oracle Cloud Ubuntu blockiert neue Ports per default in iptables INPUT chains
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 5174 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8001 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || true

echo "=== [6/6] Systemd 24/7 Autostart-Dienste einrichten ==="
CURRENT_USER=$(whoami)

# Backend Service
sudo tee /etc/systemd/system/cryptoanalyzer-backend.service > /dev/null <<EOF
[Unit]
Description=CryptoAnalyzer 24/7 Backend & Auto-Trading Bot
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$APP_DIR/backend
ExecStart=$APP_DIR/backend/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# Frontend Service (Vite Preview Production Server auf Port 5174)
sudo tee /etc/systemd/system/cryptoanalyzer-frontend.service > /dev/null <<EOF
[Unit]
Description=CryptoAnalyzer Web Terminal Frontend
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$APP_DIR/frontend
ExecStart=/usr/bin/npx vite preview --host 0.0.0.0 --port 5174
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cryptoanalyzer-backend
sudo systemctl enable cryptoanalyzer-frontend
sudo systemctl restart cryptoanalyzer-backend
sudo systemctl restart cryptoanalyzer-frontend

echo "=============================================================================="
echo "ERFOLG: CryptoAnalyzer 24/7 Cloud-Dienste sind installiert und aktiv!"
echo "Status pruefen mit: sudo systemctl status cryptoanalyzer-backend"
echo "Web-Dashboard erreichbar unter: http://<DEINE-SERVER-IP>:5174"
echo "=============================================================================="
