import os
import time
import hmac
import hashlib
import urllib.parse
from typing import Dict, Any, List, Optional
import requests

TESTNET_BASE_URL = "https://testnet.binance.vision"
MAINNET_BASE_URL = "https://api.binance.com"

def get_env_config() -> Dict[str, str]:
    """Liest die lokale .env Datei im backend Ordner ein."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(current_dir, ".env"),
        os.path.join(current_dir, "..", ".env"),
    ]
    env_vars = {}
    for path in candidates:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            env_vars[k.strip()] = v.strip().strip('"').strip("'")
                break
            except Exception:
                pass
    return env_vars

def is_testnet_mode() -> bool:
    """Prueft ob der Bot im Testnet-Modus laeuft."""
    cfg = get_env_config()
    val = os.environ.get("BINANCE_USE_TESTNET", cfg.get("BINANCE_USE_TESTNET", "true")).lower()
    return val in ["true", "1", "yes"]

def get_base_url() -> str:
    """Liefert die passende Binance Basis-URL (Testnet vs. Echtgeld)."""
    return TESTNET_BASE_URL if is_testnet_mode() else MAINNET_BASE_URL

def get_api_credentials() -> Dict[str, Any]:
    """Gibt API Key und Secret passend zum Modus (Testnet vs. Echtgeld) zurueck."""
    cfg = get_env_config()
    testnet = is_testnet_mode()

    if testnet:
        api_key = os.environ.get("BINANCE_TESTNET_API_KEY") or cfg.get("BINANCE_TESTNET_API_KEY", "")
        api_secret = os.environ.get("BINANCE_TESTNET_API_SECRET") or cfg.get("BINANCE_TESTNET_API_SECRET", "")
    else:
        api_key = os.environ.get("BINANCE_API_KEY") or cfg.get("BINANCE_API_KEY", "")
        api_secret = os.environ.get("BINANCE_API_SECRET") or cfg.get("BINANCE_API_SECRET", "")

    return {
        "api_key": api_key,
        "api_secret": api_secret,
        "is_testnet": testnet,
        "is_configured": bool(api_key and api_secret and not api_key.startswith("DEIN_"))
    }

def sign_params(params: Dict[str, Any], secret: str) -> Dict[str, Any]:
    """Signiert Parameter mit HMAC-SHA256 gemaess Binance API Spezifikation."""
    signed_params = dict(params)
    signed_params["recvWindow"] = 60000
    signed_params["timestamp"] = int(time.time() * 1000)
    query_string = urllib.parse.urlencode(signed_params)
    signature = hmac.new(
        secret.encode("utf-8"),
        query_string.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    signed_params["signature"] = signature
    return signed_params

def binance_signed_request(
    method: str,
    endpoint: str,
    params: Optional[Dict[str, Any]] = None,
    proxies: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Fuehrt einen signierten Request gegen das Binance Testnet aus."""
    creds = get_api_credentials()
    base_name = "Testnet" if creds.get("is_testnet") else "Echtgeld"

    if not creds["is_configured"]:
        return {
            "success": False,
            "error": f"Binance {base_name} API Key oder Secret fehlt. Bitte in backend/.env eintragen."
        }

    api_key = creds["api_key"]
    api_secret = creds["api_secret"]

    headers = {
        "X-MBX-APIKEY": api_key,
        "User-Agent": "CryptoAnalyzer-Agent/1.0"
    }

    url = f"{get_base_url()}{endpoint}"
    req_params = sign_params(params or {}, api_secret)

    try:
        if method.upper() == "GET":
            res = requests.get(url, headers=headers, params=req_params, proxies=proxies, timeout=10)
        elif method.upper() == "POST":
            res = requests.post(url, headers=headers, params=req_params, proxies=proxies, timeout=10)
        elif method.upper() == "DELETE":
            res = requests.delete(url, headers=headers, params=req_params, proxies=proxies, timeout=10)
        else:
            return {"success": False, "error": f"Nicht unterstuetzte HTTP-Methode: {method}"}

        data = res.json()
        if res.status_code >= 400:
            err_msg = data.get("msg", str(data))
            return {"success": False, "error": f"Binance {base_name} Fehler ({res.status_code}): {err_msg}"}
            
        return {"success": True, "data": data}
    except Exception as e:
        return {"success": False, "error": f"Netzwerkfehler zu Binance ({base_name}): {str(e)}"}

BALANCE_CACHE = {
    "timestamp": 0,
    "data": None
}

def invalidate_balance_cache():
    BALANCE_CACHE["timestamp"] = 0
    BALANCE_CACHE["data"] = None

def get_account_balance(proxies: Optional[Dict[str, str]] = None, force_refresh: bool = False) -> Dict[str, Any]:
    """Ruft Kontostand und freie Mittel im Testnet ab (mit 4s Cache fuer blitzschnelle Ladezeiten)."""
    now = time.time()
    if not force_refresh and BALANCE_CACHE["data"] and (now - BALANCE_CACHE["timestamp"] < 4.0):
        return BALANCE_CACHE["data"]
        
    res = binance_signed_request("GET", "/api/v3/account", proxies=proxies)
    if not res.get("success"):
        if BALANCE_CACHE["data"]:
            return BALANCE_CACHE["data"]
        return res
        
    data = res["data"]
    raw_balances = data.get("balances", [])
    
    # Filtere nur Assets mit Bestand > 0
    active_balances = []
    usdt_free = 0.0
    
    for b in raw_balances:
        free = float(b.get("free", 0))
        locked = float(b.get("locked", 0))
        total = free + locked
        asset = b.get("asset", "")
        if total > 0.0000001:
            active_balances.append({
                "asset": asset,
                "free": free,
                "locked": locked,
                "total": total
            })
            if asset == "USDT":
                usdt_free = free
                
    result = {
        "success": True,
        "can_trade": data.get("canTrade", False),
        "usdt_free": usdt_free,
        "balances": active_balances,
        "account_type": data.get("accountType", "SPOT")
    }
    BALANCE_CACHE["timestamp"] = now
    BALANCE_CACHE["data"] = result
    return result

def create_order(
    symbol: str,
    side: str,
    order_type: str = "MARKET",
    quantity: Optional[float] = None,
    quote_order_qty: Optional[float] = None,
    price: Optional[float] = None,
    proxies: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Erstellt eine Kauf- oder Verkaufsorder im Testnet."""
    invalidate_balance_cache()
    sym = symbol.upper().strip()
    if not sym.endswith("USDT") and not sym.endswith("BUSD"):
        sym = f"{sym}USDT"
        
    params: Dict[str, Any] = {
        "symbol": sym,
        "side": side.upper(),
        "type": order_type.upper()
    }
    
    if order_type.upper() == "MARKET":
        if quote_order_qty and quote_order_qty > 0:
            params["quoteOrderQty"] = round(quote_order_qty, 2)
        elif quantity and quantity > 0:
            params["quantity"] = quantity
        else:
            params["quoteOrderQty"] = 50.0
    elif order_type.upper() == "LIMIT":
        if not price or price <= 0:
            return {"success": False, "error": "Fuer LIMIT Orders ist ein gueltiger Preis erforderlich."}
        params["price"] = price
        params["timeInForce"] = "GTC"
        if quantity and quantity > 0:
            params["quantity"] = quantity
        elif quote_order_qty and quote_order_qty > 0:
            calc_qty = quote_order_qty / price
            params["quantity"] = round(calc_qty, 4)
        else:
            return {"success": False, "error": "Fuer LIMIT Orders muss eine Menge oder USDT-Wert angegeben werden."}
        
    res = binance_signed_request("POST", "/api/v3/order", params=params, proxies=proxies)
    return res

def get_open_orders(symbol: Optional[str] = None, proxies: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Ruft aktive offene Orders ab."""
    params = {}
    if symbol:
        sym = symbol.upper().strip()
        if not sym.endswith("USDT") and not sym.endswith("BUSD"):
            sym = f"{sym}USDT"
        params["symbol"] = sym
        
    return binance_signed_request("GET", "/api/v3/openOrders", params=params, proxies=proxies)

def cancel_order(symbol: str, order_id: int, proxies: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Storniert eine offene Order."""
    sym = symbol.upper().strip()
    if not sym.endswith("USDT") and not sym.endswith("BUSD"):
        sym = f"{sym}USDT"
        
    params = {
        "symbol": sym,
        "orderId": order_id
    }
    return binance_signed_request("DELETE", "/api/v3/order", params=params, proxies=proxies)
