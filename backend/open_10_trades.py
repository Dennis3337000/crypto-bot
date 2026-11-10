import sys
import time
import json
import binance_trader
import bot_engine
import main

coins_to_open = [
    ("BTCUSDT", "BTC", 50),
    ("ETHUSDT", "ETH", 30),
    ("SOLUSDT", "SOL", 25),
    ("XRPUSDT", "XRP", 25),
    ("LINKUSDT", "LINK", 20),
    ("AVAXUSDT", "AVAX", 20),
    ("ADAUSDT", "ADA", 20),
    ("DOGEUSDT", "DOGE", 20),
    ("SUIUSDT", "SUI", 25),
    ("NEARUSDT", "NEAR", 20)
]

# Bestehende Positionen beibehalten und fehlende ergaenzen
existing = bot_engine.load_positions()
existing_coins = [p["coin"] for p in existing]
new_positions = list(existing)

print(f"Bereits geoeffnet ({len(existing)}): {existing_coins}")

margin_per_trade = 150.0
for sym, coin, lev in coins_to_open:
    if coin in existing_coins:
        continue
    try:
        order_res = binance_trader.create_order(sym, "BUY", "MARKET", quote_order_qty=margin_per_trade)
        if not order_res.get("success"):
            print(f"Fehler bei {coin}: {order_res.get('error')}")
            continue
            
        data = order_res.get("data", {})
        executed_qty = float(data.get("executedQty", 0.0))
        fills = data.get("fills", [])
        if fills:
            avg_price = sum(float(f["price"]) * float(f["qty"]) for f in fills) / (executed_qty or 1.0)
        else:
            avg_price = main.get_coin_current_price(sym)
            
        actual_spent = avg_price * executed_qty
        notional_val = actual_spent * lev
        leveraged_qty = round(executed_qty * lev, 5)
        liq_price = round(avg_price * (1.0 - (0.88 / lev)), 4)
        
        analysis = main.get_trading_analysis(sym)
        setup = analysis.get("trade_setup", {})
        sl_val = setup.get("stop_loss", avg_price * 0.985)
        tp1_val = setup.get("take_profit_1", avg_price * 1.025)
        tp2_val = setup.get("take_profit_2", avg_price * 1.055)
        
        pos = {
            "id": f"pos_{int(time.time() * 1000)}_{coin}",
            "symbol": sym,
            "coin": coin,
            "side": "LONG",
            "leverage": lev,
            "margin_spent": round(actual_spent, 2),
            "notional_value": round(notional_val, 2),
            "entry_price": round(avg_price, 4),
            "current_price": round(avg_price, 4),
            "qty": leveraged_qty,
            "quote_spent": round(actual_spent, 2),
            "liquidation_price": liq_price,
            "stop_loss": sl_val,
            "take_profit_1": tp1_val,
            "take_profit_2": tp2_val,
            "entered_at": int(time.time()),
            "tp1_reached": False,
            "dca_count": 0,
            "unrealized_pnl_usdt": 0.0,
            "unrealized_roi_pct": 0.0,
            "score": analysis.get("rsi_15m", 88),
            "reason": f"{lev}x Hebel: {setup.get('setup_name', 'Support-Bounce')}"
        }
        new_positions.append(pos)
        print(f"  [OK] {coin}: {lev}x Hebel | Margin ${actual_spent:.2f} | Kaufkraft ${notional_val:.2f} @ ${avg_price:.2f}")
    except Exception as e:
        print(f"Ausnahme bei {coin}: {e}")

bot_engine.save_positions(new_positions)
bal = binance_trader.get_account_balance(force_refresh=True)
bot_engine.update_cached_usdt(bal["usdt_free"])
print(f"Erfolgreich {len(new_positions)} Hebel-Trades gleichzeitig eroeffnet!")
print(f"Restliches freies USDT: {bal['usdt_free']:.2f} USDT")
