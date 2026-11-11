#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

cat << 'EOF' > "$APP_DIR/backend/.env"
BINANCE_TESTNET_API_KEY=fhhN02Qr7yNlbogMopq9KhKZkUV7p88l4oQwiuXZrCXeHT4a3ETWF2GHyTkMGuos
BINANCE_TESTNET_API_SECRET=9lWBMsSiTDWtdtkRNbKlCNBIpjSZDT1PbefpDExr62MPU7QAWN1KDMK0gcvf8pSX
BINANCE_USE_TESTNET=true
AUTH_USERNAME=Dennis
AUTH_PASSWORD=3370
EOF

# Systemd Service neu starten
systemctl restart cryptobot

echo "============================================================"
echo " ERFOLG: DIE TRADING-KI WURDE INITIALISIERT UND HANDELT JETZT!"
echo " Status: systemctl status cryptobot"
echo "============================================================"
