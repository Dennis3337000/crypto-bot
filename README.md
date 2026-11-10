# Crypto Trading Scalp & Daytrading Terminal

Eine moderne, performante Webanwendung fuer Krypto-Daytrader und Scalper zur schnellen Marktanalyse und Entscheidungsfindung.

## Features
- **Coin-Auswahl:** Dropdown-Menue und Quick-Chips fuer gaengige Coins (BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, SUI, LINK, NEAR, PEPE).
- **Multi-Timeframe Marktstatistiken:**
  - Letzte 15 Minuten (Scalping-Momentum, Volumen, High, Low)
  - Letzte 1 Stunde (Intraday-Trend, Volumen, High, Low)
  - Letzte 24 Stunden (Heute - absolute & prozentuale Performance, 24h High/Low, Volumen)
  - Letzter 1 Monat (30 Tage Trend, Range)
  - Letztes 1 Jahr (52 Wochen Performance)
  - All-Time (ATH, ATL, Distanz zum Allzeithoch, Exchange-Historie)
- **Taktische Trading-Signale (Intraday):**
  - Klares Signal: 🟢 **KAUFEN (DIP-REVERSAL / AKKUMULATION / BREAKOUT)** | 🔴 **GEWINNMITNAHME (WIDERSTAND)** | 🟡 **LIMIT-KAUF VORBEREITEN**
  - Konkrete **Optimale Kauf-Range** (Min - Max) mit exakter Abstandsmessung
  - **Stop-Loss** mit prozentualem Verlustrisiko
  - **Take-Profit 1** (Teilgewinn) & **Take-Profit 2** (Hauptziel)
  - **Chance-Risiko-Verhaeltnis (CRV)**
  - Taktische Begruendung & Konfidenz
- **Trading-Range & Kauf-Zonen Radar:**
  - Visueller 3-Zonen Range-Balken: 🟢 Kauf-Zone (0-33%) | 🟡 Neutrale Mitte / Pullback (33-70%) | 🔴 Widerstand (70-100%)
  - Echtzeit-Positionsanzeige des aktuellen Kurses im Kanal (z. B. "21% im Kanal")
  - Direkte Anzeige des Abstands zur Kaufzone (z. B. "Bereits in Kauf-Range" oder "+1.2% bis Einstieg")
- **Interaktiver Chart mit Kaufzonen-Projektion:**
  - Gruen schattierter Kaufbereich (Kauf-Range) direkt ueber den Candlesticks eingezeichnet
  - Dynamischer Support- und Resistance-Kanal mit Live-Crosshair und Multi-Timeframe (15m, 1h, 4h, 1d)
- **Technische Indikatoren:**
  - RSI 15m (Momentum Gauge)
  - RSI 1h (Trend Gauge)
  - Dynamische Support- und Resistance-Zonen
- **Echtzeit-Synchronisation:**
  - Automatisches Neuladen alle 12 Sekunden (an-/abschaltbar)
  - Bosch-Proxy-kompatibel via automatischer Konfigurationserkennung

## Schnellstart

Mit einem Klick starten:
```powershell
.\Start-CryptoAnalyzer.ps1
```

Oder manuell in separaten Fenstern:
1. **Backend (Port 8001):**
   ```powershell
   cd backend
   .\start.ps1
   ```
2. **Frontend (Port 5174):**
   ```powershell
   cd frontend
   .\start.ps1
   ```
   Anschliessend Browser unter `http://localhost:5174` aufrufen.
