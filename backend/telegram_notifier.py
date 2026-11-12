import os
import json
import time
import threading
from typing import Optional, Dict, Any
import requests

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CONFIG_FILE = os.path.join(DATA_DIR, "bot_config.json")

def get_telegram_credentials() -> Dict[str, str]:
    """Liest Telegram Token und Chat-ID aus Umgebungsvariablen oder Bot-Config."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    if not token or not chat_id:
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    token = token or str(cfg.get("telegram_bot_token", "")).strip()
                    chat_id = chat_id or str(cfg.get("telegram_chat_id", "")).strip()
        except Exception:
            pass

    # Standard-Fallback auf hinterlegte Zugangsdaten
    token = token or "9167225226:AAGQtHgAeJ5C1vVm5QH8vdETyN28x9iPClw"
    chat_id = chat_id or "1028882151"

    return {"token": token, "chat_id": chat_id}

def _async_send_telegram(text: str, proxies: Optional[Dict[str, str]] = None):
    """Versendet eine Telegram-Nachricht asynchron im Hintergrund."""
    creds = get_telegram_credentials()
    token = creds["token"]
    chat_id = creds["chat_id"]

    if not token or not chat_id:
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }

    try:
        kwargs: Dict[str, Any] = {"timeout": 8}
        if proxies:
            kwargs["proxies"] = proxies
        requests.post(url, json=payload, **kwargs)
    except Exception:
        # Falls es im Firmen-Proxy blockiert wird, im Hintergrund ignorieren
        pass

def send_telegram_alert(text: str, proxies: Optional[Dict[str, str]] = None):
    """Startet den Telegram-Versand in einem entkoppelten Daemon-Thread."""
    threading.Thread(
        target=_async_send_telegram,
        args=(text, proxies),
        daemon=True
    ).start()

def notify_bot_started(mode: str, capital: float, proxies: Optional[Dict[str, str]] = None):
    msg = (
        f"<b>CryptoAnalyzer 24/7 Autopilot GESTARTET</b>\n\n"
        f"<b>Modus:</b> {mode}\n"
        f"<b>Budget:</b> ${capital:.2f} USDT\n"
        f"<b>Status:</b> Aktiv am Scannen fuer 100% A+ Setups\n"
        f"<b>Zeit:</b> {time.strftime('%d.%m.%Y %H:%M:%S')}"
    )
    send_telegram_alert(msg, proxies=proxies)

def notify_trade_opened(
    coin: str,
    entry_price: float,
    margin: float,
    sl: float,
    tp1: float,
    tp2: float,
    reason: str,
    leverage: int = 1,
    proxies: Optional[Dict[str, str]] = None
):
    lev_str = f"{leverage}x Hebel" if leverage > 1 else "1x Echter Spot-Kauf (0% Liquidation)"
    msg = (
        f"<b>NEUE POSITION EROEFFNET: {coin}</b>\n\n"
        f"<b>Typ:</b> LONG ({lev_str})\n"
        f"<b>Kaufkurs:</b> ${entry_price:.4f}\n"
        f"<b>Einsatz (Margin):</b> ${margin:.2f} USDT\n"
        f"<b>Stop-Loss:</b> ${sl:.4f} (-{abs(entry_price - sl) / entry_price * 100:.2f}%)\n"
        f"<b>Take-Profit 1:</b> ${tp1:.4f} (+{abs(tp1 - entry_price) / entry_price * 100:.2f}%)\n"
        f"<b>Take-Profit 2:</b> ${tp2:.4f} (+{abs(tp2 - entry_price) / entry_price * 100:.2f}%)\n\n"
        f"<b>Signal-Begruendung:</b> {reason}\n"
        f"<b>Zeit:</b> {time.strftime('%H:%M:%S')}"
    )
    send_telegram_alert(msg, proxies=proxies)

def notify_trade_closed(
    coin: str,
    pnl: float,
    roi: float,
    exit_price: float,
    exit_reason: str,
    leverage: int = 1,
    proxies: Optional[Dict[str, str]] = None
):
    is_win = pnl >= 0
    header = "<b>GEWINN MITGENOMMEN!</b>" if is_win else "<b>POSITION GESCHLOSSEN (STOP)</b>"
    icon = "[+]" if is_win else "[-]"
    pnl_sign = "+" if is_win else ""

    msg = (
        f"{header}\n\n"
        f"<b>Coin:</b> {coin}\n"
        f"<b>Verkaufskurs:</b> ${exit_price:.4f}\n"
        f"<b>Realisierter PnL:</b> {icon} <b>{pnl_sign}{pnl:.2f} USDT</b> ({pnl_sign}{roi:.2f}%)\n"
        f"<b>Grund:</b> {exit_reason}\n"
        f"<b>Zeit:</b> {time.strftime('%H:%M:%S')}"
    )
    send_telegram_alert(msg, proxies=proxies)

def notify_dca_triggered(
    coin: str,
    old_entry: float,
    new_entry: float,
    dca_step: int,
    added_spent: float,
    proxies: Optional[Dict[str, str]] = None
):
    msg = (
        f"<b>KI-NACHKAUF (SMART DCA): {coin}</b>\n\n"
        f"<b>Stufe:</b> {dca_step} von 2\n"
        f"<b>Nachinvestiert:</b> +${added_spent:.2f} USDT\n"
        f"<b>Mischkurs:</b> Verguenstigt von ${old_entry:.4f} auf <b>${new_entry:.4f}</b>\n"
        f"<b>Zeit:</b> {time.strftime('%H:%M:%S')}"
    )
    send_telegram_alert(msg, proxies=proxies)

def notify_circuit_breaker_tripped(daily_loss: float, limit: float, proxies: Optional[Dict[str, str]] = None):
    msg = (
        f"<b>NOTBREMSE AUSGELOEST (CIRCUIT BREAKER)!</b>\n\n"
        f"Der maximale Tagesverlust von <b>-${daily_loss:.2f} USDT</b> hat das Sicherheitslimit (${limit:.2f} USDT) ueberschritten.\n\n"
        f"<b>Aktion:</b> Alle Neukaeufe wurden zum Schutz deines Kapitals fuer heute pausiert!\n"
        f"<b>Zeit:</b> {time.strftime('%d.%m.%Y %H:%M:%S')}"
    )
    send_telegram_alert(msg, proxies=proxies)

def notify_emergency_stop(closed_count: int, reason: str, proxies: Optional[Dict[str, str]] = None):
    msg = (
        f"<b>NOTFALL-PANIK-STOPP AKTIVIERT!</b>\n\n"
        f"<b>Grund:</b> {reason}\n"
        f"<b>Aktion:</b> {closed_count} aktive Position(en) sofort liquidiert.\n"
        f"<b>Bot-Status:</b> Vollstaendig gestoppt (OFF).\n"
        f"<b>Zeit:</b> {time.strftime('%d.%m.%Y %H:%M:%S')}"
    )
    send_telegram_alert(msg, proxies=proxies)
