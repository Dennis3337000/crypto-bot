import os
import sys
import json
import time
import urllib.parse
import threading
from typing import Dict, Any, List, Optional
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="CryptoAnalyzer API",
    description="Backend API fuer Krypto-Marktstatistiken und Trading-Signale",
    version="1.0.0"
)

# CORS aktivieren fuer Frontend-Zugriff
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-Memory Cache gegen Rate-Limits (mit automatischer Speicherbereinigung)
CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 8

def load_proxy_config() -> Dict[str, str]:
    """Laedt optionale Proxy-Konfiguration aus tools/config.json."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(current_dir, "..", "..", "..", "tools", "config.json"),
        os.path.join(current_dir, "..", "..", "tools", "config.json"),
        os.path.join(current_dir, "config.json"),
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8-sig") as f:
                    cfg = json.load(f)
                    proxies = {}
                    if cfg.get("http_proxy"):
                        proxies["http"] = cfg.get("http_proxy")
                    if cfg.get("https_proxy"):
                        proxies["https"] = cfg.get("https_proxy")
                    return proxies
            except Exception:
                pass
    return {}

PROXIES = load_proxy_config()

COINS_CATALOG = [
    {"symbol": "BTCUSDT", "coin": "BTC", "name": "Bitcoin", "category": "Layer 1 / Store of Value"},
    {"symbol": "ETHUSDT", "coin": "ETH", "name": "Ethereum", "category": "Smart Contracts / Layer 1"},
    {"symbol": "SOLUSDT", "coin": "SOL", "name": "Solana", "category": "High-Speed Layer 1"},
    {"symbol": "BNBUSDT", "coin": "BNB", "name": "BNB", "category": "Exchange Ecosystem"},
    {"symbol": "XRPUSDT", "coin": "XRP", "name": "Ripple", "category": "Payments & Settlement"},
    {"symbol": "DOGEUSDT", "coin": "DOGE", "name": "Dogecoin", "category": "Meme / Payment"},
    {"symbol": "ADAUSDT", "coin": "ADA", "name": "Cardano", "category": "Proof-of-Stake L1"},
    {"symbol": "AVAXUSDT", "coin": "AVAX", "name": "Avalanche", "category": "Layer 1 Scaling"},
    {"symbol": "SUIUSDT", "coin": "SUI", "name": "Sui", "category": "Move-based Layer 1"},
    {"symbol": "LINKUSDT", "coin": "LINK", "name": "Chainlink", "category": "Oracle Infrastructure"},
    {"symbol": "NEARUSDT", "coin": "NEAR", "name": "NEAR Protocol", "category": "Sharded Layer 1"},
    {"symbol": "PEPEUSDT", "coin": "PEPE", "name": "Pepe", "category": "Meme Token"}
]

def binance_get(endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
    """Fuehrt GET-Request an die Binance API aus mit Proxy, Timeout und Cache-Purge."""
    base_url = "https://api.binance.com"
    url = f"{base_url}{endpoint}"
    cache_key = f"{endpoint}?{json.dumps(params, sort_keys=True)}"
    
    now = time.time()
    # Cache bereinigen wenn zu gross (schuetzt vor OOM auf Render/Serverless)
    if len(CACHE) > 100:
        expired = [k for k, v in CACHE.items() if now - v.get("timestamp", 0) > CACHE_TTL_SECONDS * 2]
        for k in expired:
            CACHE.pop(k, None)

    if cache_key in CACHE:
        item = CACHE[cache_key]
        if now - item["timestamp"] < CACHE_TTL_SECONDS:
            return item["data"]
            
    try:
        kwargs: Dict[str, Any] = {"timeout": 10}
        if PROXIES:
            kwargs["proxies"] = PROXIES
        resp = requests.get(url, params=params, **kwargs)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Binance API Fehler: {resp.text}")
        data = resp.json()
        CACHE[cache_key] = {"data": data, "timestamp": now}
        return data
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Netzwerkfehler zur Binance API: {str(e)}")

def calculate_rsi(closes: List[float], period: int = 14) -> float:
    """Berechnet Relative Strength Index (RSI)."""
    if len(closes) < period + 1:
        return 50.0
    gains = []
    losses = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        if diff >= 0:
            gains.append(diff)
            losses.append(0.0)
        else:
            gains.append(0.0)
            losses.append(abs(diff))
            
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 2)

@app.get("/api/health")
def get_health() -> Dict[str, Any]:
    return {"status": "ok", "proxy_active": bool(PROXIES), "timestamp": time.time()}

@app.get("/api/coins")
def get_coins() -> List[Dict[str, Any]]:
    """Liefert Liste der vorkonfigurierten Coins fuer das Dropdown."""
    return COINS_CATALOG

@app.get("/api/market/{symbol}")
def get_market_statistics(symbol: str = "BTCUSDT") -> Dict[str, Any]:
    """Berechnet und aggregiert Marktstatistiken fuer 15m, 1h, 24h, 1M, 1Y und All-Time."""
    sym = symbol.upper().strip()
    if not sym.endswith("USDT") and not sym.endswith("BUSD"):
        sym = f"{sym}USDT"
        
    # 1. 24h Ticker Abfrage
    ticker_24h = binance_get("/api/v3/ticker/24hr", {"symbol": sym})
    current_price = float(ticker_24h["lastPrice"])
    price_change_24h_pct = float(ticker_24h["priceChangePercent"])
    price_change_24h_usd = float(ticker_24h["priceChange"])
    high_24h = float(ticker_24h["highPrice"])
    low_24h = float(ticker_24h["lowPrice"])
    volume_24h = float(ticker_24h["volume"])
    quote_volume_24h = float(ticker_24h["quoteVolume"])
    
    # 2. 15 Minuten Statistik (Klines 15m, letzte 4 Kerzen)
    klines_15m = binance_get("/api/v3/klines", {"symbol": sym, "interval": "15m", "limit": 4})
    # Vorherige geschlossene 15m Kerze vs. aktuelle Kerze
    open_15m = float(klines_15m[-1][1])
    change_15m_pct = ((current_price - open_15m) / open_15m) * 100 if open_15m > 0 else 0.0
    vol_15m = float(klines_15m[-1][5])
    high_15m = float(klines_15m[-1][2])
    low_15m = float(klines_15m[-1][3])
    
    # 3. 1 Stunde Statistik (Klines 1h, letzte 3 Kerzen)
    klines_1h = binance_get("/api/v3/klines", {"symbol": sym, "interval": "1h", "limit": 3})
    open_1h = float(klines_1h[-1][1])
    change_1h_pct = ((current_price - open_1h) / open_1h) * 100 if open_1h > 0 else 0.0
    vol_1h = float(klines_1h[-1][5])
    high_1h = float(klines_1h[-1][2])
    low_1h = float(klines_1h[-1][3])
    
    # 4. 1 Monat (30 Tage) Statistik (Klines 1d, 31 Kerzen)
    klines_1d = binance_get("/api/v3/klines", {"symbol": sym, "interval": "1d", "limit": 31})
    open_30d = float(klines_1d[0][1])
    change_1m_pct = ((current_price - open_30d) / open_30d) * 100 if open_30d > 0 else 0.0
    high_1m = max(float(k[2]) for k in klines_1d)
    low_1m = min(float(k[3]) for k in klines_1d)
    
    # 5. 1 Jahr (52 Wochen) Statistik (Klines 1w, 53 Kerzen)
    klines_1w = binance_get("/api/v3/klines", {"symbol": sym, "interval": "1w", "limit": 53})
    open_1y = float(klines_1w[0][1])
    change_1y_pct = ((current_price - open_1y) / open_1y) * 100 if open_1y > 0 else 0.0
    high_1y = max(float(k[2]) for k in klines_1w)
    low_1y = min(float(k[3]) for k in klines_1w)
    
    # 6. All-Time Statistik (Klines 1M, bis zu 120 Monate)
    klines_all = binance_get("/api/v3/klines", {"symbol": sym, "interval": "1M", "limit": 120})
    ath = max(float(k[2]) for k in klines_all)
    atl = min(float(k[3]) for k in klines_all)
    earliest_open = float(klines_all[0][1])
    all_time_change_pct = ((current_price - earliest_open) / earliest_open) * 100 if earliest_open > 0 else 0.0
    history_months = len(klines_all)
    
    return {
        "symbol": sym,
        "current_price": current_price,
        "stats_15m": {
            "interval_label": "Letzte 15 Minuten",
            "change_pct": round(change_15m_pct, 2),
            "high": high_15m,
            "low": low_15m,
            "volume_base": round(vol_15m, 2),
            "open": open_15m
        },
        "stats_1h": {
            "interval_label": "Letzte 1 Stunde",
            "change_pct": round(change_1h_pct, 2),
            "high": high_1h,
            "low": low_1h,
            "volume_base": round(vol_1h, 2),
            "open": open_1h
        },
        "stats_24h": {
            "interval_label": "Heute (24 Stunden)",
            "change_pct": round(price_change_24h_pct, 2),
            "change_usd": round(price_change_24h_usd, 2),
            "high": high_24h,
            "low": low_24h,
            "volume_base": round(volume_24h, 2),
            "volume_quote_usd": round(quote_volume_24h, 2)
        },
        "stats_1m": {
            "interval_label": "Letzter 1 Monat",
            "change_pct": round(change_1m_pct, 2),
            "high": high_1m,
            "low": low_1m
        },
        "stats_1y": {
            "interval_label": "Letztes 1 Jahr",
            "change_pct": round(change_1y_pct, 2),
            "high": high_1y,
            "low": low_1y
        },
        "stats_all_time": {
            "interval_label": "All-Time (Historie)",
            "change_pct": round(all_time_change_pct, 2),
            "ath": ath,
            "atl": atl,
            "distance_to_ath_pct": round(((current_price - ath) / ath) * 100, 2),
            "history_months": history_months
        }
    }

def smart_round(val: float, ref_price: float) -> float:
    if ref_price >= 100:
        return round(val, 2)
    elif ref_price >= 1:
        return round(val, 3)
    elif ref_price >= 0.01:
        return round(val, 4)
    else:
        return round(val, 7)

def format_num_str(val: float, ref_price: float) -> str:
    if ref_price >= 1000:
        return f"{val:,.2f}"
    elif ref_price >= 1:
        return f"{val:.3f}"
    elif ref_price >= 0.01:
        return f"{val:.4f}"
    else:
        return f"{val:.6f}"

@app.get("/api/analysis/{symbol}")
def get_trading_analysis(symbol: str = "BTCUSDT") -> Dict[str, Any]:
    """Generiert ein professionelles Intraday-Trading-Signal mit Entry, SL, TP und CRV."""
    sym = symbol.upper().strip()
    if not sym.endswith("USDT") and not sym.endswith("BUSD"):
        sym = f"{sym}USDT"
        
    # Klines fuer Indikatorberechnung (15m fuer Momentum, 1h fuer Trend)
    klines_15m = binance_get("/api/v3/klines", {"symbol": sym, "interval": "15m", "limit": 40})
    klines_1h = binance_get("/api/v3/klines", {"symbol": sym, "interval": "1h", "limit": 40})
    
    closes_15m = [float(k[4]) for k in klines_15m]
    closes_1h = [float(k[4]) for k in klines_1h]
    current_price = closes_15m[-1]
    
    rsi_15m = calculate_rsi(closes_15m, period=14)
    rsi_1h = calculate_rsi(closes_1h, period=14)
    
    # Lokale Hochs und Tiefs fuer Support & Resistance (letzte 24 Kerzen auf 1h)
    recent_highs = [float(k[2]) for k in klines_1h[-24:]]
    recent_lows = [float(k[3]) for k in klines_1h[-24:]]
    
    resistance_1 = smart_round(max(recent_highs), current_price)
    support_1 = smart_round(min(recent_lows), current_price)
    
    range_span = resistance_1 - support_1
    if range_span <= 0 or range_span < (current_price * 0.015):
        range_span = current_price * 0.035
        resistance_1 = smart_round(current_price * 1.025, current_price)
        support_1 = smart_round(current_price * 0.975, current_price)
        
    raw_range_pos = ((current_price - support_1) / range_span) * 100
    range_position_pct = min(100.0, max(0.0, round(raw_range_pos, 1)))
    
    buy_range_min = smart_round(support_1 * 0.998, current_price)
    buy_range_max = smart_round(support_1 + (range_span * 0.33), current_price)
    buy_range_label = f"{format_num_str(buy_range_min, current_price)} - {format_num_str(buy_range_max, current_price)}"
    
    distance_to_buy_pct = 0.0 if current_price <= buy_range_max else round(((current_price - buy_range_max) / current_price) * 100, 2)
    distance_to_sup_pct = round(abs(current_price - support_1) / current_price * 100, 2)
    distance_to_res_pct = round(abs(resistance_1 - current_price) / current_price * 100, 2)
    
    range_status = "KONSOLIDIERUNG / MITTE"
    if range_position_pct <= 33:
        range_status = "KAUF-ZONE (DIP / AKKUMULATION)"
    elif range_position_pct >= 70:
        range_status = "WIDERSTANDSZIELE / VERKAUF"
        
    signal = "WAIT"
    signal_label = "LIMIT-KAUF VORBEREITEN"
    setup_type = "Pullback-Order in Kauf-Range"
    entry_target = smart_round(support_1 + (range_span * 0.15), current_price)
    entry_min = buy_range_min
    entry_max = buy_range_max
    stop_loss = smart_round(support_1 * 0.991, current_price)
    take_profit_1 = smart_round(support_1 + (range_span * 0.55), current_price)
    take_profit_2 = smart_round(resistance_1 * 0.995, current_price)
    confidence = "8/10"
    rationale = f"Kurs konsolidiert in der Range-Mitte ({range_position_pct}%). Nicht ueber Marktpreise kaufen, sondern Kauflimits in der Kauf-Range ({buy_range_label}) staffeln (Abstand: +{distance_to_buy_pct}%)."
    
    if (range_position_pct <= 33 or distance_to_sup_pct <= 2.2) and rsi_15m <= 44:
        signal = "BUY"
        signal_label = "KAUFEN (DIP-REVERSAL)"
        setup_type = "Support-Bounce / Oversold Dip-Kauf"
        entry_target = smart_round(current_price, current_price)
        entry_min = buy_range_min
        entry_max = smart_round(max(current_price, buy_range_max), current_price)
        stop_loss = smart_round(support_1 * 0.991, current_price)
        take_profit_1 = smart_round(support_1 + (range_span * 0.55), current_price)
        take_profit_2 = smart_round(resistance_1 * 0.995, current_price)
        confidence = "9/10"
        rationale = f"Kurs notiert mit {range_position_pct}% direkt in der optimalen Kauf-Range ({buy_range_label}). RSI 15m ({rsi_15m}) zeigt ideales Reversal-Niveau mit starkem CRV."
    elif range_position_pct <= 35 and rsi_15m <= 58:
        signal = "BUY"
        signal_label = "KAUFEN (AKKUMULATIONS-ZONE)"
        setup_type = "Range-Bottom Akkumulation"
        entry_target = smart_round(current_price, current_price)
        entry_min = buy_range_min
        entry_max = buy_range_max
        stop_loss = smart_round(support_1 * 0.991, current_price)
        take_profit_1 = smart_round(support_1 + (range_span * 0.55), current_price)
        take_profit_2 = smart_round(resistance_1 * 0.995, current_price)
        confidence = "8/10"
        rationale = f"Kurs befindet sich im unteren Drittel der Handelsspanne ({range_position_pct}% vom Support). Sehr guenstiges Niveau zur Akkumulation vor dem naechsten Impuls."
    elif current_price >= (resistance_1 * 0.988) and rsi_15m >= 56 and rsi_1h >= 50:
        signal = "BUY"
        signal_label = "KAUFEN (BREAKOUT-MOMENTUM)"
        setup_type = "Widerstands-Ausbruch / Trendfolge"
        entry_target = smart_round(current_price, current_price)
        entry_min = smart_round(resistance_1 * 0.992, current_price)
        entry_max = smart_round(resistance_1 * 1.008, current_price)
        stop_loss = smart_round(resistance_1 * 0.985, current_price)
        take_profit_1 = smart_round(resistance_1 * 1.025, current_price)
        take_profit_2 = smart_round(resistance_1 * 1.055, current_price)
        confidence = "8/10"
        rationale = f"Kurs bricht dynamisch an der oberen Range-Kante aus (RSI 15m: {rsi_15m}). Starkes Momentum; Trendfolge-Kauf mit engem Stop unter Ausbruchskante."
    elif range_position_pct >= 72 or (rsi_15m >= 68 and distance_to_res_pct < 2.0):
        signal = "SELL"
        signal_label = "GEWINNMITNAHME / WIDERSTAND"
        setup_type = "Resistance-Rejection / Overbought Fade"
        entry_target = smart_round(resistance_1 * 0.997, current_price)
        entry_min = smart_round(resistance_1 * 0.992, current_price)
        entry_max = smart_round(resistance_1 * 1.005, current_price)
        stop_loss = smart_round(resistance_1 * 1.012, current_price)
        take_profit_1 = smart_round(support_1 + (range_span * 0.5), current_price)
        take_profit_2 = smart_round(buy_range_max, current_price)
        confidence = "8/10"
        rationale = f"Kurs ist im oberen Range-Bereich ({range_position_pct}%). RSI ({rsi_15m}) signalisiert Ueberhitzung. Gewinne sichern; Neukauf erst wieder in der Kauf-Range ({buy_range_label})."

    risk = abs(entry_target - stop_loss)
    reward_1 = abs(take_profit_1 - entry_target)
    reward_2 = abs(take_profit_2 - entry_target)
    crv_1 = round(reward_1 / risk, 2) if risk > 0 else 1.5
    crv_2 = round(reward_2 / risk, 2) if risk > 0 else 2.8

    return {
        "symbol": sym,
        "current_price": current_price,
        "signal": signal,
        "signal_label": signal_label,
        "confidence": confidence,
        "rsi_15m": rsi_15m,
        "rsi_1h": rsi_1h,
        "support_level": support_1,
        "resistance_level": resistance_1,
        "range_position_pct": range_position_pct,
        "range_status": range_status,
        "buy_range_min": buy_range_min,
        "buy_range_max": buy_range_max,
        "buy_range_label": buy_range_label,
        "distance_to_buy_pct": distance_to_buy_pct,
        "trade_setup": {
            "setup_name": setup_type,
            "entry_zone": f"{entry_min} - {entry_max}",
            "buy_range_min": buy_range_min,
            "buy_range_max": buy_range_max,
            "buy_range_label": buy_range_label,
            "range_position_pct": range_position_pct,
            "range_status": range_status,
            "distance_to_buy_pct": distance_to_buy_pct,
            "stop_loss": stop_loss,
            "stop_loss_pct": round(abs((stop_loss - current_price) / current_price) * 100, 2),
            "take_profit_1": take_profit_1,
            "take_profit_1_pct": round(abs((take_profit_1 - current_price) / current_price) * 100, 2),
            "take_profit_2": take_profit_2,
            "take_profit_2_pct": round(abs((take_profit_2 - current_price) / current_price) * 100, 2),
            "crv": f"{crv_2} : 1 (Ziel TP2)",
            "crv_tp1": f"{crv_1} : 1",
            "tactical_rationale": rationale
        }
    }

@app.get("/api/klines/{symbol}")
def get_chart_klines(symbol: str = "BTCUSDT", interval: str = "15m", limit: int = 60) -> List[Dict[str, Any]]:
    """Liefert Candlestick-Historie fuer den interaktiven Chart."""
    sym = symbol.upper().strip()
    if not sym.endswith("USDT") and not sym.endswith("BUSD"):
        sym = f"{sym}USDT"
        
    valid_intervals = ["15m", "1h", "4h", "1d"]
    if interval not in valid_intervals:
        interval = "15m"
        
    limit = max(10, min(120, limit))
    raw_klines = binance_get("/api/v3/klines", {"symbol": sym, "interval": interval, "limit": limit})
    
    result = []
    for k in raw_klines:
        result.append({
            "time": int(k[0]),
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
            "close_time": int(k[6])
        })
    return result

# Cache fuer Best-Pick um Binance API zu schonen
BEST_PICK_CACHE: Dict[str, Any] = {"timestamp": 0, "data": None}

@app.get("/api/best-pick")
def get_best_buy_pick() -> Dict[str, Any]:
    """Scannt alle Coins und ermittelt den aktuell lukrativsten Coin fuer einen Einstieg."""
    now = time.time()
    if BEST_PICK_CACHE["data"] and (now - BEST_PICK_CACHE["timestamp"] < 25):
        return BEST_PICK_CACHE["data"]
        
    evaluated_coins = []
    
    for item in COINS_CATALOG:
        sym = item["symbol"]
        try:
            analysis = get_trading_analysis(sym)
            ticker = binance_get("/api/v3/ticker/24hr", {"symbol": sym})
            price_24h_pct = float(ticker["priceChangePercent"])
            
            # Bewertungsscore fuer Kauf (0 bis 100)
            score = 50.0
            reasons = []
            
            rsi = analysis["rsi_15m"]
            # 1. RSI-Kriterium: Ueberverkaufte Reversal-Zonen belohnen
            if rsi < 30:
                score += 30.0
                reasons.append(f"Stark ueberverkauft (RSI 15m: {rsi})")
            elif rsi < 40:
                score += 18.0
                reasons.append(f"Attraktiver Dip-Bereich (RSI 15m: {rsi})")
            elif rsi > 70:
                score -= 30.0
                reasons.append(f"Ueberkauft (RSI 15m: {rsi})")
                
            # 2. Naehe zur optimalen Kauf-Range und Support
            range_pos = analysis.get("range_position_pct", 50.0)
            if range_pos <= 22:
                score += 30.0
                reasons.append(f"Direkt am Range-Boden ({range_pos}% der Handelsspanne)")
            elif range_pos <= 35:
                score += 22.0
                reasons.append(f"In der optimalen Kauf-Range ({range_pos}% der Handelsspanne)")
            elif range_pos > 72:
                score -= 25.0
                reasons.append(f"Nahe oberem Range-Widerstand ({range_pos}%)")
                
            dist_buy = analysis.get("distance_to_buy_pct", 99.0)
            if dist_buy == 0.0:
                score += 15.0
                reasons.append("Bereits in der Kauf-Zone")
            elif dist_buy <= 1.5:
                score += 8.0
                reasons.append(f"Nur +{dist_buy}% bis zur Kauf-Range")
                    
            # 3. Signal-Bonus
            if analysis["signal"] == "BUY":
                score += 25.0
                reasons.append(f"Signal: {analysis['signal_label']}")
            elif analysis["signal"] == "SELL":
                score -= 35.0
                
            # 4. CRV und Potenzial
            setup = analysis["trade_setup"]
            tp2_pct = setup.get("take_profit_2_pct", 0)
            sl_pct = setup.get("stop_loss_pct", 1)
            if sl_pct > 0:
                crv_calc = tp2_pct / sl_pct
                if crv_calc >= 2.5:
                    score += 15.0
                    reasons.append(f"Starkes CRV ({setup['crv']})")
                    
            final_score = max(5.0, min(99.0, round(score, 1)))
            
            evaluated_coins.append({
                "symbol": sym,
                "coin": item["coin"],
                "name": item["name"],
                "category": item["category"],
                "current_price": analysis["current_price"],
                "change_24h_pct": price_24h_pct,
                "score": final_score,
                "signal": analysis["signal"],
                "signal_label": analysis["signal_label"],
                "rsi_15m": rsi,
                "entry_zone": setup["entry_zone"],
                "buy_range_min": analysis.get("buy_range_min"),
                "buy_range_max": analysis.get("buy_range_max"),
                "buy_range_label": analysis.get("buy_range_label"),
                "range_position_pct": analysis.get("range_position_pct"),
                "range_status": analysis.get("range_status"),
                "distance_to_buy_pct": analysis.get("distance_to_buy_pct"),
                "stop_loss": setup["stop_loss"],
                "take_profit_1": setup["take_profit_1"],
                "take_profit_2": setup["take_profit_2"],
                "crv": setup["crv"],
                "reasons": reasons,
                "tactical_rationale": setup["tactical_rationale"]
            })
        except Exception:
            continue
            
    # Nach bestem Score sortieren
    evaluated_coins.sort(key=lambda x: x["score"], reverse=True)
    
    best = evaluated_coins[0] if evaluated_coins else None
    result = {
        "best_pick": best,
        "ranking": evaluated_coins[:6],
        "all_evaluated": evaluated_coins,
        "generated_at": time.strftime("%H:%M:%S")
    }
    BEST_PICK_CACHE["timestamp"] = now
    BEST_PICK_CACHE["data"] = result
    return result

# --- BINANCE TESTNET TRADING ENDPOINTS ---
try:
    import binance_trader
except ImportError:
    from . import binance_trader

@app.get("/api/trading/status")
def get_trading_bot_status() -> Dict[str, Any]:
    """Prueft ob Testnet-Keys hinterlegt sind und liefert Verbindungsstatus."""
    creds = binance_trader.get_api_credentials()
    if not creds["is_configured"]:
        return {
            "configured": False,
            "message": "Binance Testnet API Key und Secret fehlen. Bitte in backend/.env eintragen."
        }
    balance_res = binance_trader.get_account_balance(proxies=PROXIES)
    return {
        "configured": True,
        "connected": balance_res.get("success", False),
        "data": balance_res
    }

@app.get("/api/trading/balance")
def get_trading_balance() -> Dict[str, Any]:
    """Liefert aktuellen USDT-Kontostand und Token-Bestaende im Testnet."""
    return binance_trader.get_account_balance(proxies=PROXIES)

@app.post("/api/trading/order")
def execute_trade_order(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Platziert eine Kauf- oder Verkaufsorder im Binance Testnet."""
    symbol = payload.get("symbol", "BTCUSDT")
    side = payload.get("side", "BUY")
    order_type = payload.get("order_type", "MARKET")
    quantity = float(payload["quantity"]) if payload.get("quantity") else None
    quote_order_qty = float(payload["quote_order_qty"]) if payload.get("quote_order_qty") else None
    price = float(payload.get("price")) if payload.get("price") else None
    
    return binance_trader.create_order(
        symbol=symbol,
        side=side,
        order_type=order_type,
        quantity=quantity,
        quote_order_qty=quote_order_qty,
        price=price,
        proxies=PROXIES
    )

@app.get("/api/trading/open-orders")
def get_open_orders_list(symbol: Optional[str] = None) -> Dict[str, Any]:
    """Liefert alle aktiven Testnet-Orders."""
    return binance_trader.get_open_orders(symbol=symbol, proxies=PROXIES)

@app.delete("/api/trading/order")
def cancel_trade_order(symbol: str, order_id: int) -> Dict[str, Any]:
    """Storniert eine aktive Order im Testnet."""
    return binance_trader.cancel_order(symbol=symbol, order_id=order_id, proxies=PROXIES)

# --- 24/7 AUTONOMER TRADING-BOT ENGINE ---
try:
    import bot_engine
except ImportError:
    from . import bot_engine

GLOBAL_PRICES_CACHE: Dict[str, float] = {}
PRICES_CACHE_TIME: float = 0.0

def get_relevant_symbols() -> List[str]:
    """Ermittelt alle relevanten Symbole (Katalog + offene Positionen)."""
    symbols = {item["symbol"] for item in COINS_CATALOG}
    try:
        positions = bot_engine.load_positions()
        for p in positions:
            if p.get("symbol"):
                symbols.add(p["symbol"])
    except Exception:
        pass
    return sorted(list(symbols))

def get_relevant_prices() -> Dict[str, float]:
    """Holt schonend und blitzschnell nur die relevanten Coin-Preise ueber Binance."""
    global GLOBAL_PRICES_CACHE, PRICES_CACHE_TIME
    now = time.time()
    if GLOBAL_PRICES_CACHE and (now - PRICES_CACHE_TIME < 3.0):
        return GLOBAL_PRICES_CACHE

    symbols = get_relevant_symbols()
    try:
        symbols_json = json.dumps(symbols)
        url = f"https://api.binance.com/api/v3/ticker/price?symbols={urllib.parse.quote(symbols_json)}"
        kwargs: Dict[str, Any] = {"timeout": 6}
        if PROXIES:
            kwargs["proxies"] = PROXIES
        resp = requests.get(url, **kwargs)
        if resp.status_code == 200:
            for item in resp.json():
                GLOBAL_PRICES_CACHE[item["symbol"]] = float(item["price"])
            PRICES_CACHE_TIME = now
    except Exception:
        pass
    return GLOBAL_PRICES_CACHE

def get_coin_current_price(symbol: str) -> float:
    sym = symbol.upper().strip()
    if not sym.endswith("USDT") and not sym.endswith("BUSD"):
        sym = f"{sym}USDT"
    prices = get_relevant_prices()
    if sym in prices:
        return prices[sym]
    try:
        res = binance_get("/api/v3/ticker/price", {"symbol": sym})
        price = float(res.get("price", 0.0))
        GLOBAL_PRICES_CACHE[sym] = price
        return price
    except Exception:
        return 0.0

@app.get("/api/health")
def health_check() -> Dict[str, Any]:
    """Health-Check fuer Uptime-Monitore."""
    return {"status": "ok", "time": time.time()}

@app.get("/api/prices")
def get_live_prices_api() -> Dict[str, float]:
    """Liefert alle aktuellen Live-Preise fuer offene Trades und Top-Coins."""
    return get_relevant_prices()

@app.on_event("startup")
def startup_event():
    """Startet den 24/7 Autonomen Trading-Bot automatisch beim Backend-Boot."""
    creds = binance_trader.get_api_credentials()
    if creds["is_configured"]:
        bot_engine.start_bot_background(
            get_price_func=get_coin_current_price,
            analysis_func=get_trading_analysis,
            best_pick_func=get_best_buy_pick,
            proxies=PROXIES
        )

@app.get("/api/bot/status")
def get_bot_status_api() -> Dict[str, Any]:
    """Liefert den 24/7 Bot-Status mit aktuellen Live-Preisen aller Positionen."""
    return bot_engine.get_bot_status(price_provider_func=get_coin_current_price)

@app.post("/api/bot/toggle")
def toggle_bot_api(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Schaltet den 24/7 Autopiloten an oder aus."""
    enable = payload.get("enabled", True)
    cfg = bot_engine.load_config()
    cfg["enabled"] = enable
    bot_engine.save_config(cfg)
    
    if enable:
        bot_engine.start_bot_background(
            get_price_func=get_coin_current_price,
            analysis_func=get_trading_analysis,
            best_pick_func=get_best_buy_pick,
            proxies=PROXIES
        )
    else:
        bot_engine.stop_bot_background()
        
    return bot_engine.get_bot_status()

@app.post("/api/bot/config")
def update_bot_config_api(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Aktualisiert Bot-Parameter (z.B. Order-Groesse, Min-Score)."""
    cfg = bot_engine.load_config()
    for k, v in payload.items():
        cfg[k] = v
    bot_engine.save_config(cfg)
    return {"success": True, "config": cfg}

@app.post("/api/bot/close-position")
def close_bot_position_api(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Schliesst eine aktive Position manuell ueber das Dashboard."""
    pos_id = payload.get("position_id", "")
    reason = payload.get("reason", "Manuell ueber Dashboard geschlossen")
    return bot_engine.close_active_position(pos_id, reason, proxies=PROXIES)

@app.get("/api/bot/journal")
def get_bot_journal_api() -> List[Dict[str, Any]]:
    """Liefert die vollstaendige Historie aller abgeschlossenen Trades."""
    return bot_engine.load_journal()

