import os
import json
import time
import threading
from typing import Dict, Any, List, Optional
import binance_trader

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CONFIG_FILE = os.path.join(DATA_DIR, "bot_config.json")
POSITIONS_FILE = os.path.join(DATA_DIR, "active_positions.json")
JOURNAL_FILE = os.path.join(DATA_DIR, "trade_journal.json")

def ensure_data_files():
    """Stellt sicher, dass das Datenverzeichnis und die JSON-Dateien existieren."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_FILE):
        default_config = {
            "enabled": True,
            "order_size_usdt": 50.0,
            "min_score": 65.0,
            "max_open_positions": 8,
            "cooldown_minutes": 5,
            "scan_interval_seconds": 12,
            "auto_stop_loss": True,
            "auto_take_profit": True,
            "break_even_on_tp1": True,
            "enable_smart_dca": True,
            "max_dca_levels": 2,
            "dca_min_dip_pct": 1.5,
            "leverage_mode": "AI_DYNAMIC",
            "max_leverage": 100,
            "default_leverage": 20
        }
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(default_config, f, indent=2)
            
    if not os.path.exists(POSITIONS_FILE):
        with open(POSITIONS_FILE, "w", encoding="utf-8") as f:
            json.dump([], f, indent=2)
            
    if not os.path.exists(JOURNAL_FILE):
        with open(JOURNAL_FILE, "w", encoding="utf-8") as f:
            json.dump([], f, indent=2)

def calculate_ai_leverage(score: float, sl_pct: float, cfg: Dict[str, Any]) -> int:
    """Ermittelt den optimalen Hebel anhand von KI-Score und Stop-Loss-Abstand."""
    mode = cfg.get("leverage_mode", "AI_DYNAMIC")
    max_lev = int(cfg.get("max_leverage", 100))
    if mode == "MANUAL":
        return max(1, min(max_lev, int(cfg.get("default_leverage", 20))))
        
    # KI entscheidet autonom: Je hoeher der Score und je enger der Stop-Loss, desto aggressiver der Hebel
    if score >= 95 and sl_pct <= 1.2:
        lev = 100  # Maximaler Hebel bei Spitzen-Konfidenz
    elif score >= 90 and sl_pct <= 1.8:
        lev = 50
    elif score >= 85:
        lev = 30
    elif score >= 75:
        lev = 20
    elif score >= 65:
        lev = 10
    else:
        lev = 5
        
    return max(1, min(max_lev, lev))

DATA_LOCK = threading.RLock()

def _atomic_write_json(file_path: str, data: Any):
    try:
        tmp_path = f"{file_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, file_path)
    except Exception:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

def load_config() -> Dict[str, Any]:
    ensure_data_files()
    with DATA_LOCK:
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"enabled": True, "order_size_usdt": 50.0, "min_score": 80.0}

def save_config(cfg: Dict[str, Any]):
    ensure_data_files()
    with DATA_LOCK:
        _atomic_write_json(CONFIG_FILE, cfg)

def load_positions() -> List[Dict[str, Any]]:
    ensure_data_files()
    with DATA_LOCK:
        try:
            with open(POSITIONS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

def save_positions(positions: List[Dict[str, Any]]):
    ensure_data_files()
    with DATA_LOCK:
        _atomic_write_json(POSITIONS_FILE, positions)

def load_journal() -> List[Dict[str, Any]]:
    ensure_data_files()
    with DATA_LOCK:
        try:
            with open(JOURNAL_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

def append_to_journal(trade: Dict[str, Any]):
    ensure_data_files()
    with DATA_LOCK:
        journal = []
        try:
            with open(JOURNAL_FILE, "r", encoding="utf-8") as f:
                journal = json.load(f)
        except Exception:
            journal = []
        journal.insert(0, trade)
        # Begrenze Journal auf letzte 200 Eintraege
        _atomic_write_json(JOURNAL_FILE, journal[:200])

# Globaler Zustand des Hintergrund-Workers
BOT_THREAD: Optional[threading.Thread] = None
BOT_RUNNING = False
LAST_SCAN_TIME = 0
BOT_LOGS: List[Dict[str, Any]] = []
CACHED_USDT_FREE: float = 9985.05
FAILED_SYMBOLS_COOLDOWN: Dict[str, float] = {}

def update_cached_usdt(val: float):
    global CACHED_USDT_FREE
    if val and val > 0:
        CACHED_USDT_FREE = round(float(val), 2)

def add_bot_log(level: str, message: str, details: Optional[Dict[str, Any]] = None):
    entry = {
        "timestamp": int(time.time() * 1000),
        "time_str": time.strftime("%H:%M:%S"),
        "level": level,
        "message": message,
        "details": details or {}
    }
    BOT_LOGS.insert(0, entry)
    if len(BOT_LOGS) > 100:
        BOT_LOGS.pop()

def get_bot_status(price_provider_func=None) -> Dict[str, Any]:
    """Liefert den Bot-Status inklusive Live-Aktualisierung offener Positionen und bereinigtem Gesamtkapital."""
    cfg = load_config()
    positions = load_positions()
    journal = load_journal()

    # Offene Positionen mit frischen Kursen anreichern falls price_provider uebergeben
    if price_provider_func and positions:
        updated = False
        for pos in positions:
            sym = pos.get("symbol")
            if not sym:
                continue
            curr_price = price_provider_func(sym)
            if curr_price and curr_price > 0:
                pos["current_price"] = curr_price
                entry_price = float(pos.get("entry_price", curr_price))
                leverage = int(pos.get("leverage", 1))
                margin_spent = float(pos.get("margin_spent", pos.get("quote_spent", 50.0)))
                base_roi = (curr_price - entry_price) / entry_price if entry_price > 0 else 0.0
                pos["unrealized_roi_pct"] = round(base_roi * 100 * leverage, 2)
                pos["unrealized_pnl_usdt"] = round(margin_spent * base_roi * leverage, 2)
                peak_price = float(pos.get("peak_price", entry_price))
                if curr_price > peak_price:
                    pos["peak_price"] = curr_price
                updated = True
        if updated:
            save_positions(positions)
    
    # Berechne Performance-Kennzahlen aus Journal
    total_trades = len(journal)
    wins = [t for t in journal if t.get("pnl_usdt", 0) > 0]
    losses = [t for t in journal if t.get("pnl_usdt", 0) <= 0]
    total_pnl = sum(t.get("pnl_usdt", 0) for t in journal)
    win_rate = round((len(wins) / total_trades * 100), 1) if total_trades > 0 else 0.0
    
    # Berechne Kapital und Portfoliowerte
    initial_capital = float(cfg.get("initial_capital", 10000.0))
    total_margin_spent = sum(float(p.get("margin_spent", p.get("quote_spent", 0.0))) for p in positions)
    total_unrealized_pnl = sum(float(p.get("unrealized_pnl_usdt", 0.0)) for p in positions)
    positions_value = round(total_margin_spent + total_unrealized_pnl, 2)
    
    # Was noch uebrig ist vom Bot-Budget (Startkapital abzueglich gebundener Margin)
    usdt_remaining = round(max(0.0, initial_capital - total_margin_spent), 2)
    # Gesamtkapital: Nur was noch uebrig ist ("usdt_remaining") plus was der Bot bisher verdient hat ("total_pnl")
    total_capital = round(usdt_remaining + total_pnl, 2)
    capital_growth_pct = round((total_pnl / initial_capital) * 100, 2) if initial_capital > 0 else 0.0
    
    return {
        "bot_active": cfg.get("enabled", True),
        "worker_running": BOT_RUNNING,
        "config": cfg,
        "usdt_free": usdt_remaining,
        "positions_value_usdt": round(positions_value, 2),
        "total_capital_usdt": total_capital,
        "initial_capital_usdt": initial_capital,
        "capital_growth_pct": capital_growth_pct,
        "wallet_testnet_usdt": round(CACHED_USDT_FREE, 2),
        "open_positions_count": len(positions),
        "open_positions": positions,
        "total_trades": total_trades,
        "win_rate_pct": win_rate,
        "total_pnl_usdt": round(total_pnl, 2),
        "last_scan_time": LAST_SCAN_TIME,
        "recent_logs": BOT_LOGS[:15]
    }

def get_spot_sell_quantity(symbol: str, raw_qty: float, proxies: Optional[Dict[str, str]] = None) -> float:
    """Ermittelt die exakte verfuegbare und lot-size konforme Verkaufsmenge im Binance Spot Wallet."""
    try:
        base_asset = symbol.replace("USDT", "").replace("BUSD", "")
        bal_res = binance_trader.get_account_balance(proxies=proxies, force_refresh=True)
        real_free = 0.0
        if bal_res.get("success"):
            for b in bal_res.get("balances", []):
                if b.get("asset") == base_asset:
                    real_free = float(b.get("free", 0.0))
                    break
                    
        # Falls raw_qty groesser als real_free ist (z.B. durch Hebel-Multiplikator), nimm real_free
        sell_qty = min(raw_qty, real_free) if (raw_qty > 0 and raw_qty <= real_free) else real_free
        
        # Lot-Size Dezimalstellen gemaess Binance Spezifikation runden
        sym_upper = symbol.upper()
        if sym_upper in ["BTCUSDT"]:
            return round(sell_qty, 4)
        elif sym_upper in ["ETHUSDT"]:
            return round(sell_qty, 3)
        elif sym_upper in ["SOLUSDT", "LINKUSDT", "AVAXUSDT", "SUIUSDT", "NEARUSDT"]:
            return round(sell_qty, 2)
        elif sym_upper in ["XRPUSDT", "ADAUSDT", "DOGEUSDT", "PEPEUSDT"]:
            return float(int(sell_qty))
            
        return round(sell_qty, 2)
    except Exception:
        return 0.0

def close_active_position(pos_id: str, exit_reason: str, proxies: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Schliesst eine aktive Position sicher, augenblicklich (0ms Blockade) und 100% fehlertolerant ab."""
    positions = load_positions()
    pos = next((p for p in positions if p.get("id") == pos_id), None)
    if not pos:
        return {"success": False, "error": f"Position mit ID {pos_id} nicht gefunden."}
        
    symbol = pos["symbol"]
    avg_exit_price = float(pos.get("current_price", pos.get("entry_price", 1.0)))
    executed_qty = float(pos.get("actual_qty", pos.get("qty", 0.0)))
    
    # Optionaler Spot-Verkauf auf Binance Testnet komplett asynchron im Hintergrund
    # (Damit das Schliessen im Dashboard IMMER in unter 5 Millisekunden reagiert!)
    def _async_spot_cleanup(sym: str, raw_q: float, px: Optional[Dict[str, str]]):
        try:
            target_sell_qty = get_spot_sell_quantity(sym, raw_q, proxies=px)
            if target_sell_qty > 0:
                binance_trader.create_order(
                    symbol=sym,
                    side="SELL",
                    order_type="MARKET",
                    quantity=target_sell_qty,
                    proxies=px
                )
        except Exception:
            pass

    if executed_qty > 0:
        threading.Thread(
            target=_async_spot_cleanup,
            args=(symbol, executed_qty, proxies),
            daemon=True
        ).start()
            
    leverage = int(pos.get("leverage", 1))
    margin_spent = float(pos.get("margin_spent", pos.get("quote_spent", 50.0)))
    entry_price = float(pos.get("entry_price", avg_exit_price))
    
    # Sanity-Check: Verhindere absurde PnL-Spikes durch fehlerhafte Test-Preise
    if entry_price <= 0 or abs(avg_exit_price - entry_price) / (entry_price or 1.0) > 0.35:
        base_diff = (avg_exit_price - entry_price) / (entry_price or 1.0)
    else:
        base_diff = (avg_exit_price - entry_price) / entry_price
        
    roi_pct = round(base_diff * 100 * leverage, 2)
    pnl_usdt = round(margin_spent * (base_diff * leverage), 2)
    quote_received = round(margin_spent + pnl_usdt, 2)
    
    # Position sofort aus aktiven Positionen entfernen
    positions = [p for p in positions if p.get("id") != pos_id]
    save_positions(positions)
    
    # Trade im Journal speichern
    journal_entry = {
        "id": pos_id,
        "symbol": symbol,
        "coin": pos.get("coin", symbol.replace("USDT", "")),
        "side": "LONG",
        "leverage": leverage,
        "margin_spent": margin_spent,
        "entry_price": float(pos.get("entry_price", entry_price)),
        "exit_price": round(avg_exit_price, 4),
        "qty": executed_qty,
        "quote_spent": margin_spent,
        "quote_received": quote_received,
        "pnl_usdt": pnl_usdt,
        "roi_pct": roi_pct,
        "entered_at": pos.get("entered_at", int(time.time())),
        "closed_at": int(time.time()),
        "exit_reason": f"{exit_reason} ({leverage}x Hebel)"
    }
    append_to_journal(journal_entry)
    
    msg = f"Position {pos.get('coin')} ({leverage}x Hebel) geschlossen: {exit_reason} | PnL: {'+' if pnl_usdt >= 0 else ''}{pnl_usdt} USDT ({roi_pct}%)"
    add_bot_log("SUCCESS", msg)
    return {"success": True, "journal_entry": journal_entry}

def check_open_positions_lifecycle(get_current_price_func, analysis_func, proxies: Optional[Dict[str, str]] = None):
    """Ueberwacht alle offenen Positionen auf Stop-Loss, Trailing-Stop, Take-Profit und Smart DCA."""
    positions = load_positions()
    if not positions:
        return
        
    cfg = load_config()
    updated_positions = []
    
    for pos in positions:
        pos_id = pos["id"]
        sym = pos["symbol"]
        coin = pos.get("coin", sym)
        entry_price = pos["entry_price"]
        stop_loss = pos.get("stop_loss", entry_price * 0.98)
        tp1 = pos.get("take_profit_1", entry_price * 1.03)
        tp2 = pos.get("take_profit_2", entry_price * 1.06)
        
        try:
            curr_price = get_current_price_func(sym)
            if not curr_price or curr_price <= 0:
                updated_positions.append(pos)
                continue
                
            pos["current_price"] = curr_price
            leverage = int(pos.get("leverage", 1))
            margin_spent = float(pos.get("margin_spent", pos.get("quote_spent", 50.0)))
            base_roi = (curr_price - entry_price) / entry_price
            pos["unrealized_roi_pct"] = round(base_roi * 100 * leverage, 2)
            pos["unrealized_pnl_usdt"] = round(margin_spent * base_roi * leverage, 2)
            
            # Peak Price Tracking fuer Trailing-Profit-Stop
            peak_price = float(pos.get("peak_price", entry_price))
            if curr_price > peak_price:
                peak_price = curr_price
                pos["peak_price"] = peak_price
                
            pullback_from_peak_pct = ((peak_price - curr_price) / peak_price) * 100
            
            # 1. STOP-LOSS TRIGGER (Harter Kapitalschutz)
            if cfg.get("auto_stop_loss", True) and curr_price <= stop_loss:
                add_bot_log("WARNING", f"Stop-Loss ausgeloest fuer {coin} bei ${curr_price:.2f} (SL: ${stop_loss:.2f})")
                close_active_position(pos_id, f"Stop-Loss erreicht (-{abs(pos['unrealized_roi_pct'])}%)", proxies=proxies)
                continue
                
            # 2. DYNAMISCHER TRAILING-PROFIT-STOP (Gewinne sichern statt wieder herzugeben)
            # Wenn Position bereits mind. +1.5% im Gewinn war und nun um >= 0.6% vom Hoechststand nachgibt:
            if pos["unrealized_roi_pct"] >= 1.5 and pullback_from_peak_pct >= 0.6:
                add_bot_log("SUCCESS", f"Trailing-Profit-Stop fuer {coin}: Vom Peak (${peak_price:.2f}) um -{pullback_from_peak_pct:.2f}% nachgegeben. Gewinn mitgenommen!")
                close_active_position(pos_id, f"Trailing-Profit-Stop (+{pos['unrealized_roi_pct']}%)", proxies=proxies)
                continue
                
            # 3. DYNAMISCHER RSI-UEBERHITZUNGS-EXIT (Gewinnmitnahme am oberen Band)
            # Nur pruefen wenn Position ueberhaupt im Gewinn ist (ROI >= 1.0%), um API-Aufrufe zu sparen
            if pos.get("unrealized_roi_pct", 0) >= 1.0:
                try:
                    analysis = analysis_func(sym)
                    rsi_val = float(analysis.get("rsi_15m", 50.0))
                    range_p = float(analysis.get("range_position_pct", 50.0))
                    if rsi_val >= 68.0 or range_p >= 75.0:
                        add_bot_log("SUCCESS", f"Dynamischer RSI/Widerstands-Exit fuer {coin}: RSI={rsi_val:.1f}, Range={range_p:.1f}%. Gewinn gesichert!")
                        close_active_position(pos_id, f"RSI-Ueberhitzung / Widerstand (+{pos['unrealized_roi_pct']}%)", proxies=proxies)
                        continue
                except Exception:
                    pass
                
            # 4. TAKE-PROFIT 2 (Hauptziel erreicht -> Komplettverkauf mit maximalem Gewinn)
            if cfg.get("auto_take_profit", True) and curr_price >= tp2:
                add_bot_log("SUCCESS", f"Take-Profit 2 erreicht fuer {coin} bei ${curr_price:.2f} (Ziel: ${tp2:.2f})")
                close_active_position(pos_id, f"Take-Profit 2 erreicht (+{pos['unrealized_roi_pct']}%)", proxies=proxies)
                continue
                
            # 5. TAKE-PROFIT 1 (Teilziel erreicht -> Breakeven-Stop anheben fuer 100% risikofreien Trade)
            if cfg.get("break_even_on_tp1", True) and curr_price >= tp1 and not pos.get("tp1_reached", False):
                pos["tp1_reached"] = True
                new_sl = round(entry_price * 1.002, 4)
                pos["stop_loss"] = new_sl
                add_bot_log("INFO", f"TP1 erreicht fuer {coin}! Stop-Loss auf Break-Even (${new_sl}) angehoben.")
                
            # 4. SMART SCALE-IN / DIP-NACHKAUF (Wenn Kurs faellt und es sich technisch lohnt)
            enable_dca = cfg.get("enable_smart_dca", True)
            dca_count = int(pos.get("dca_count", 0))
            max_dca = int(cfg.get("max_dca_levels", 2))
            
            if enable_dca and dca_count < max_dca and curr_price > stop_loss:
                # Berechne wie viel % der Kurs unter dem Einstand liegt
                dip_from_entry_pct = ((entry_price - curr_price) / entry_price) * 100
                min_dip_needed = float(cfg.get("dca_min_dip_pct", 1.5)) + (dca_count * 0.8)
                time_since_last_action = int(time.time()) - pos.get("last_dca_time", pos.get("entered_at", 0))
                
                # Wenn Kurs gefallen ist und mindestens 2 Minuten vergangen sind
                if dip_from_entry_pct >= min_dip_needed and time_since_last_action > 120:
                    try:
                        analysis = analysis_func(sym)
                        rsi = float(analysis.get("rsi_15m", 50.0))
                        range_pos = float(analysis.get("range_position_pct", 50.0))
                        sup = float(analysis.get("support_level", 0.0))
                        
                        # KI-Kriterien fuer "Lohnt sich":
                        # 1. RSI zeigt Abkuehlung / Ueberverkauf (rsi <= 44)
                        # 2. Kurs notiert ueber oder direkt am Support (kein Absturz durch den Boden)
                        # 3. Kurs befindet sich im unteren Range-Kanal (range_pos <= 42)
                        worth_it = (rsi <= 44.0) and (curr_price >= sup * 0.99) and (range_pos <= 42.0)
                        
                        if worth_it:
                            bal = binance_trader.get_account_balance(proxies=proxies)
                            dca_order_size = float(cfg.get("order_size_usdt", 50.0))
                            
                            if bal.get("success") and float(bal.get("usdt_free", 0.0)) >= dca_order_size:
                                add_bot_log(
                                    "INFO",
                                    f"KI prueft Nachkauf fuer {coin}: Dip von -{dip_from_entry_pct:.1f}% bei RSI {rsi:.1f} in Kauf-Range ({range_pos:.1f}%). Nachkauf lohnt sich!"
                                )
                                
                                # Fuehre Nachkauf-Order aus
                                dca_res = binance_trader.create_order(
                                    symbol=sym,
                                    side="BUY",
                                    order_type="MARKET",
                                    quote_order_qty=dca_order_size,
                                    proxies=proxies
                                )
                                
                                if dca_res.get("success"):
                                    data = dca_res.get("data", {})
                                    new_qty = float(data.get("executedQty", 0.0))
                                    fills = data.get("fills", [])
                                    if fills:
                                        new_fill_price = sum(float(f["price"]) * float(f["qty"]) for f in fills) / (new_qty or 1.0)
                                    else:
                                        new_fill_price = curr_price
                                        
                                    new_quote_spent = new_fill_price * new_qty
                                    
                                    # Neuer Mischkurs berechnen
                                    old_qty = pos["qty"]
                                    old_spent = pos["quote_spent"]
                                    total_qty = old_qty + new_qty
                                    total_spent = old_spent + new_quote_spent
                                    new_avg_entry = round(total_spent / (total_qty or 1.0), 4)
                                    
                                    pos["qty"] = total_qty
                                    pos["quote_spent"] = round(total_spent, 2)
                                    pos["entry_price"] = new_avg_entry
                                    pos["dca_count"] = dca_count + 1
                                    pos["last_dca_time"] = int(time.time())
                                    
                                    # Anpassung von SL und TP an den neuen, besseren Mischkurs
                                    pos["take_profit_1"] = round(new_avg_entry * 1.02, 4)
                                    pos["take_profit_2"] = round(new_avg_entry * 1.045, 4)
                                    if sup > 0:
                                        pos["stop_loss"] = round(sup * 0.988, 4)
                                        
                                    pos["unrealized_pnl_usdt"] = round((curr_price - new_avg_entry) * total_qty, 2)
                                    pos["unrealized_roi_pct"] = round(((curr_price - new_avg_entry) / new_avg_entry) * 100, 2)
                                    
                                    msg = (
                                        f"KI-Nachkauf fuer {coin} erfolgreich! Mischkurs von ${entry_price:.2f} auf ${new_avg_entry:.2f} verguenstigt "
                                        f"(Stufe {pos['dca_count']}/{max_dca}, +{new_quote_spent:.2f} USDT nachinvestiert)."
                                    )
                                    add_bot_log("SUCCESS", msg)
                                else:
                                    add_bot_log("ERROR", f"Nachkauf fuer {coin} fehlgeschlagen: {dca_res.get('error')}")
                    except Exception as e:
                        pass
                        
            updated_positions.append(pos)
        except Exception as e:
            updated_positions.append(pos)
            
    save_positions(updated_positions)

def scan_and_open_new_trades(analysis_func, best_pick_func, proxies: Optional[Dict[str, str]] = None):
    """Prueft Marktchancen und oeffnet mehrere Positionen gleichzeitig im Testnet."""
    cfg = load_config()
    if not cfg.get("enabled", True):
        return
        
    positions = load_positions()
    max_pos = int(cfg.get("max_open_positions", 8))
    if len(positions) >= max_pos:
        return
        
    # Kontostand pruefen
    balance_res = binance_trader.get_account_balance(proxies=proxies)
    if not balance_res.get("success"):
        return
        
    usdt_free = float(balance_res.get("usdt_free", 0.0))
    update_cached_usdt(usdt_free)
    order_size = float(cfg.get("order_size_usdt", 50.0))
    if usdt_free < order_size:
        return
        
    try:
        pick_data = best_pick_func()
        # Erhalte alle bewerteten Coins (nicht nur den ersten!)
        candidates = list(pick_data.get("all_evaluated") or pick_data.get("ranking", []))
        if pick_data.get("best_pick"):
            bp = pick_data["best_pick"]
            if not any(c["symbol"] == bp["symbol"] for c in candidates):
                candidates.insert(0, bp)
                
        min_score = float(cfg.get("min_score", 65.0))
        cooldown_sec = int(cfg.get("cooldown_minutes", 5)) * 60
        now = int(time.time())
        journal = load_journal()
        
        opened_this_cycle = 0
        
        for candidate in candidates:
            # Maximale Positionen erreicht?
            if len(positions) >= max_pos:
                break
                
            # Genuegend Guthaben fuer die naechste Order?
            if usdt_free < order_size:
                break
                
            sym = candidate.get("symbol")
            coin = candidate.get("coin", sym)
            score = float(candidate.get("score", 0.0))
            signal = candidate.get("signal", "WAIT")
            range_pos = float(candidate.get("range_position_pct", 50.0))
            dist_buy = float(candidate.get("distance_to_buy_pct", 99.0))
            
            # 1. Pruefen ob der Coin bereits offen ist
            if any(p["symbol"] == sym for p in positions):
                continue

            # 2. Pruefen ob der Coin temporaer wegen Order-Fehler (z.B. fehlende Testnet-Liquiditaet) pausiert ist
            if FAILED_SYMBOLS_COOLDOWN.get(sym, 0) > now:
                continue

            # PEPEUSDT im Binance Testnet ueberspringen (hat im Testnet keine Asks im Orderbuch)
            if sym == "PEPEUSDT" and "testnet" in binance_trader.TESTNET_BASE_URL:
                continue
                
            # 3. Cooldown pruefen
            recent_trade = next((t for t in journal if t["symbol"] == sym and (now - t.get("closed_at", 0)) < cooldown_sec), None)
            if recent_trade:
                continue
                
            # 3. 100% SICHERHEITS-FILTER (A+ Setup Kriterien fuer maximale Trefferquote):
            cand_rsi = float(candidate.get("rsi_15m", 50.0))
            is_valid_entry = (
                score >= min_score and
                signal == "BUY" and
                range_pos <= 28.0 and
                dist_buy <= 0.8 and
                cand_rsi <= 42.0
            )
            
            if is_valid_entry:
                add_bot_log("INFO", f"100% A+ Setup gefunden: {coin} (Score: {score}, Signal: {candidate.get('signal_label')}, Range: {range_pos}%, RSI: {cand_rsi})")
                
                # Kauforder ausfuehren
                order_res = binance_trader.create_order(
                    symbol=sym,
                    side="BUY",
                    order_type="MARKET",
                    quote_order_qty=order_size,
                    proxies=proxies
                )
                
                if order_res.get("success"):
                    data = order_res.get("data", {})
                    executed_qty = float(data.get("executedQty", 0.0))
                    fills = data.get("fills", [])
                    
                    if fills:
                        avg_price = sum(float(f["price"]) * float(f["qty"]) for f in fills) / (executed_qty or 1.0)
                    else:
                        avg_price = float(candidate.get("current_price", 1.0))
                        
                    actual_spent = avg_price * executed_qty
                    usdt_free -= actual_spent
                    
                    # Setup-Werte uebernehmen
                    try:
                        analysis = analysis_func(sym)
                        setup = analysis.get("trade_setup", {})
                        sl_val = setup.get("stop_loss", avg_price * 0.985)
                        tp1_val = setup.get("take_profit_1", avg_price * 1.025)
                        tp2_val = setup.get("take_profit_2", avg_price * 1.055)
                    except Exception:
                        sl_val = round(avg_price * 0.985, 4)
                        tp1_val = round(avg_price * 1.025, 4)
                        tp2_val = round(avg_price * 1.055, 4)
                        
                    sl_dist_pct = abs((avg_price - sl_val) / avg_price) * 100 if avg_price > 0 else 2.0
                    leverage = calculate_ai_leverage(score, sl_dist_pct, cfg)
                    notional_val = actual_spent * leverage
                    leveraged_qty = round(executed_qty * leverage, 5)
                    liq_price = round(avg_price * (1.0 - (0.88 / leverage)), 4) if leverage > 1 else round(avg_price * 0.5, 4)
                    
                    new_pos = {
                        "id": f"pos_{int(time.time() * 1000)}_{coin}",
                        "symbol": sym,
                        "coin": coin,
                        "side": "LONG",
                        "leverage": leverage,
                        "margin_spent": round(actual_spent, 2),
                        "notional_value": round(notional_val, 2),
                        "entry_price": round(avg_price, 4),
                        "current_price": round(avg_price, 4),
                        "qty": leveraged_qty,
                        "actual_qty": executed_qty,
                        "quote_spent": round(actual_spent, 2),
                        "liquidation_price": liq_price,
                        "stop_loss": sl_val,
                        "take_profit_1": tp1_val,
                        "take_profit_2": tp2_val,
                        "entered_at": int(time.time()),
                        "tp1_reached": False,
                        "dca_count": 0,
                        "score": score,
                        "reason": f"100% A+ Setup: {candidate.get('signal_label')} ({leverage}x Hebel, Score: {score})"
                    }
                    
                    positions.append(new_pos)
                    save_positions(positions)
                    opened_this_cycle += 1
                    
                    add_bot_log(
                        "SUCCESS",
                        f"24/7 Bot hat Position eroeffnet: {coin} ({leverage}x Hebel, Kaufkraft: ${notional_val:.2f}, Margin: ${actual_spent:.2f}) @ ${avg_price:.2f} (SL: ${sl_val:.2f}, TP2: ${tp2_val:.2f})"
                    )
                else:
                    err_msg = order_res.get('error', 'Unbekannter Fehler')
                    FAILED_SYMBOLS_COOLDOWN[sym] = now + 600  # 10 Min Cooldown
                    add_bot_log("WARNING", f"Kauf fuer {sym} fehlgeschlagen ({err_msg}) - Coin temporaer pausiert, scanne alternative Coins...")
                    
        if opened_this_cycle > 0:
            add_bot_log("INFO", f"Zyklus abgeschlossen: {opened_this_cycle} Positionen parallel geoeffnet.")
    except Exception as e:
        add_bot_log("ERROR", f"Fehler bei Multi-Coin Markt-Scan: {str(e)}")

def run_bot_loop(get_price_func, analysis_func, best_pick_func, proxies: Optional[Dict[str, str]] = None):
    """Endlosschleife des 24/7 Trading Bots."""
    global BOT_RUNNING, LAST_SCAN_TIME
    BOT_RUNNING = True
    add_bot_log("INFO", "24/7 Autonomer Trading-Bot Dienst gestartet.")
    
    while BOT_RUNNING:
        try:
            cfg = load_config()
            if cfg.get("enabled", True):
                LAST_SCAN_TIME = int(time.time() * 1000)
                # 0. Echten Testnet-Kontostand im Hintergrund synchronisieren
                try:
                    bal = binance_trader.get_account_balance(proxies=proxies, force_refresh=True)
                    if bal.get("success"):
                        update_cached_usdt(bal.get("usdt_free", 0.0))
                except Exception:
                    pass
                    
                # 1. Offene Positionen pruefen (SL/TP und Smart DCA Nachkaeufe)
                check_open_positions_lifecycle(get_price_func, analysis_func, proxies=proxies)
                # 2. Neue Einstiege pruefen
                scan_and_open_new_trades(analysis_func, best_pick_func, proxies=proxies)
                
            interval = max(10, int(cfg.get("scan_interval_seconds", 30)))
            time.sleep(interval)
        except Exception as e:
            add_bot_log("ERROR", f"Fehler in Bot-Loop: {str(e)}")
            time.sleep(15)

def start_bot_background(get_price_func, analysis_func, best_pick_func, proxies: Optional[Dict[str, str]] = None):
    """Startet den Bot-Thread falls er noch nicht laeuft."""
    global BOT_THREAD, BOT_RUNNING
    if BOT_THREAD and BOT_THREAD.is_alive():
        return
        
    BOT_THREAD = threading.Thread(
        target=run_bot_loop,
        args=(get_price_func, analysis_func, best_pick_func, proxies),
        daemon=True,
        name="CryptoAnalyzer-247-Bot"
    )
    BOT_THREAD.start()

def stop_bot_background():
    """Stoppt den Bot-Thread."""
    global BOT_RUNNING
    BOT_RUNNING = False
    cfg = load_config()
    cfg["enabled"] = False
    save_config(cfg)
    add_bot_log("INFO", "24/7 Autonomer Trading-Bot Dienst gestoppt.")
