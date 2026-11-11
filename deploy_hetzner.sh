#!/bin/bash
# ==============================================================================
# CryptoAnalyzer - Hetzner Cloud 24/7 Deployment Script
# Getestet fuer Ubuntu 22.04 / 24.04 LTS (Hetzner CX22)
# ==============================================================================

set -e

echo "=== [1/5] System aktualisieren & Pakete installieren ==="
sudo apt-get update -y
sudo apt-get install -y python3 python3-pip python3-venv curl git ufw

echo "=== [2/5] Node.js 20 installieren (fuer Frontend-Build) ==="
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "=== [3/5] Frontend bauen (Production Build) ==="
cd "$APP_DIR/frontend"
npm install
npm run build

echo "=== [4/5] Python Backend einrichten ==="
cd "$APP_DIR/backend"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# .env vorbereiten falls nicht vorhanden
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "Hinweis: backend/.env wurde aus .env.example erstellt."
    fi
fi

echo "=== [5/5] 24/7 Autostart Systemd-Dienst einrichten ==="
CURRENT_USER=$(whoami)

# Systemd Service: Bindet direkt an Port 80 (Standard Web-Port)
# Erlaubt Python an Port 80 zu binden ohne Root-Rechte
sudo setcap 'cap_net_bind_service=+ep' "$APP_DIR/backend/venv/bin/python" 2>/dev/null || true

sudo tee /etc/systemd/system/cryptobot.service > /dev/null <<EOF
[Unit]
Description=CryptoAnalyzer 24/7 Trading Bot & Web Dashboard
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$APP_DIR/backend
ExecStart=$APP_DIR/backend/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 80
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# Firewall Ports freischalten
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 8001/tcp || true
sudo ufw --force enable || true

# Dienst aktivieren und starten
sudo systemctl daemon-reload
sudo systemctl enable cryptobot
sudo systemctl restart cryptobot

SERVER_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')

echo "=============================================================================="
echo " GLUECKWUNSCH: Der Trading-Bot laeuft jetzt 24/7 auf deinem Hetzner Server!"
echo " Status pruefen: sudo systemctl status cryptobot"
echo " Live-Logs ansehen: sudo journalctl -u cryptobot -f"
echo " Dashboard im Browser oeffnen: http://$SERVER_IP"
echo "=============================================================================="
