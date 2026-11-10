import { CoinItem, MarketData, TradingAnalysis, KlineData, BestPick, BestPickResponse, BotStatus, TradeExecution, ActivePosition, TradeJournalEntry, ServerBotStatus } from './types';

export const COINS_CATALOG: CoinItem[] = [
  { symbol: 'BTCUSDT', coin: 'BTC', name: 'Bitcoin', category: 'Layer 1 / Store of Value' },
  { symbol: 'ETHUSDT', coin: 'ETH', name: 'Ethereum', category: 'Smart Contracts / Layer 1' },
  { symbol: 'SOLUSDT', coin: 'SOL', name: 'Solana', category: 'High-Speed Layer 1' },
  { symbol: 'BNBUSDT', coin: 'BNB', name: 'BNB', category: 'Exchange Ecosystem' },
  { symbol: 'XRPUSDT', coin: 'XRP', name: 'Ripple', category: 'Payments & Settlement' },
  { symbol: 'DOGEUSDT', coin: 'DOGE', name: 'Dogecoin', category: 'Meme / Payment' },
  { symbol: 'ADAUSDT', coin: 'ADA', name: 'Cardano', category: 'Proof-of-Stake L1' },
  { symbol: 'AVAXUSDT', coin: 'AVAX', name: 'Avalanche', category: 'Layer 1 Scaling' },
  { symbol: 'SUIUSDT', coin: 'SUI', name: 'Sui', category: 'Move-based Layer 1' },
  { symbol: 'LINKUSDT', coin: 'LINK', name: 'Chainlink', category: 'Oracle Infrastructure' },
  { symbol: 'NEARUSDT', coin: 'NEAR', name: 'NEAR Protocol', category: 'Sharded Layer 1' },
  { symbol: 'PEPEUSDT', coin: 'PEPE', name: 'Pepe', category: 'Meme Token' }
];

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const CACHE = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL = 8000; // 8 Sekunden Cache

async function apiFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(endpoint, init);
    if (res.ok) return res;
  } catch {
    // Weiter
  }
  return await fetch(`http://127.0.0.1:8001${endpoint}`, init);
}

async function binanceGet(endpoint: string, params: Record<string, string | number> = {}): Promise<any> {
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    searchParams.set(k, String(v));
  }
  const queryString = searchParams.toString();
  const url = `${BINANCE_BASE}${endpoint}${queryString ? '?' + queryString : ''}`;

  const now = Date.now();
  const cached = CACHE.get(url);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Binance API Fehler (${res.status}): ${errorText}`);
  }
  const data = await res.json();
  CACHE.set(url, { timestamp: now, data });
  return data;
}

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50.0;
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      gains.push(diff);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(diff));
    }
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return Math.round((100.0 - 100.0 / (1.0 + rs)) * 100) / 100;
}

export async function getCoins(): Promise<CoinItem[]> {
  try {
    const res = await apiFetch('/api/coins');
    if (res.ok) return await res.json();
  } catch {
    // Fallback auf statischen Katalog
  }
  return COINS_CATALOG;
}

export async function getMarketData(symbol: string): Promise<MarketData> {
  const sym = symbol.toUpperCase().trim();

  // 1. Lokales Backend via apiFetch
  try {
    const res = await apiFetch(`/api/market/${sym}`);
    if (res.ok) return await res.json();
  } catch {
    // Weiter mit direktem Binance Client-Aufruf
  }

  // 2. Direkter Aufruf der Binance API im Browser
  const [ticker24h, klines15m, klines1h, klines1d, klines1w, klines1M] = await Promise.all([
    binanceGet('/ticker/24hr', { symbol: sym }),
    binanceGet('/klines', { symbol: sym, interval: '15m', limit: 4 }),
    binanceGet('/klines', { symbol: sym, interval: '1h', limit: 3 }),
    binanceGet('/klines', { symbol: sym, interval: '1d', limit: 31 }),
    binanceGet('/klines', { symbol: sym, interval: '1w', limit: 53 }),
    binanceGet('/klines', { symbol: sym, interval: '1M', limit: 120 })
  ]);

  const currentPrice = parseFloat(ticker24h.lastPrice);
  const priceChange24hPct = parseFloat(ticker24h.priceChangePercent);
  const priceChange24hUsd = parseFloat(ticker24h.priceChange);
  const high24h = parseFloat(ticker24h.highPrice);
  const low24h = parseFloat(ticker24h.lowPrice);
  const volume24h = parseFloat(ticker24h.volume);
  const quoteVolume24h = parseFloat(ticker24h.quoteVolume);

  // 15m
  const last15m = klines15m[klines15m.length - 1];
  const open15m = parseFloat(last15m[1]);
  const change15mPct = open15m > 0 ? ((currentPrice - open15m) / open15m) * 100 : 0.0;
  const high15m = parseFloat(last15m[2]);
  const low15m = parseFloat(last15m[3]);
  const vol15m = parseFloat(last15m[5]);

  // 1h
  const last1h = klines1h[klines1h.length - 1];
  const open1h = parseFloat(last1h[1]);
  const change1hPct = open1h > 0 ? ((currentPrice - open1h) / open1h) * 100 : 0.0;
  const high1h = parseFloat(last1h[2]);
  const low1h = parseFloat(last1h[3]);
  const vol1h = parseFloat(last1h[5]);

  // 1d (30 Tage)
  const open30d = parseFloat(klines1d[0][1]);
  const change1mPct = open30d > 0 ? ((currentPrice - open30d) / open30d) * 100 : 0.0;
  const high1m = Math.max(...klines1d.map((k: any) => parseFloat(k[2])));
  const low1m = Math.min(...klines1d.map((k: any) => parseFloat(k[3])));

  // 1y (52 Wochen)
  const open1y = parseFloat(klines1w[0][1]);
  const change1yPct = open1y > 0 ? ((currentPrice - open1y) / open1y) * 100 : 0.0;
  const high1y = Math.max(...klines1w.map((k: any) => parseFloat(k[2])));
  const low1y = Math.min(...klines1w.map((k: any) => parseFloat(k[3])));

  // All-Time
  const ath = Math.max(...klines1M.map((k: any) => parseFloat(k[2])));
  const atl = Math.min(...klines1M.map((k: any) => parseFloat(k[3])));
  const earliestOpen = parseFloat(klines1M[0][1]);
  const allTimeChangePct = earliestOpen > 0 ? ((currentPrice - earliestOpen) / earliestOpen) * 100 : 0.0;
  const historyMonths = klines1M.length;

  return {
    symbol: sym,
    current_price: currentPrice,
    stats_15m: {
      interval_label: 'Letzte 15 Minuten',
      change_pct: Math.round(change15mPct * 100) / 100,
      high: high15m,
      low: low15m,
      volume_base: Math.round(vol15m * 100) / 100,
      open: open15m
    },
    stats_1h: {
      interval_label: 'Letzte 1 Stunde',
      change_pct: Math.round(change1hPct * 100) / 100,
      high: high1h,
      low: low1h,
      volume_base: Math.round(vol1h * 100) / 100,
      open: open1h
    },
    stats_24h: {
      interval_label: 'Heute (24 Stunden)',
      change_pct: Math.round(priceChange24hPct * 100) / 100,
      change_usd: Math.round(priceChange24hUsd * 100) / 100,
      high: high24h,
      low: low24h,
      volume_base: Math.round(volume24h * 100) / 100,
      volume_quote_usd: Math.round(quoteVolume24h * 100) / 100
    },
    stats_1m: {
      interval_label: 'Letzter 1 Monat',
      change_pct: Math.round(change1mPct * 100) / 100,
      high: high1m,
      low: low1m
    },
    stats_1y: {
      interval_label: 'Letztes 1 Jahr',
      change_pct: Math.round(change1yPct * 100) / 100,
      high: high1y,
      low: low1y
    },
    stats_all_time: {
      interval_label: 'All-Time (Historie)',
      change_pct: Math.round(allTimeChangePct * 100) / 100,
      ath,
      atl,
      distance_to_ath_pct: Math.round(((currentPrice - ath) / ath) * 10000) / 100,
      history_months: historyMonths
    }
  };
}

function smartRound(val: number, refPrice: number): number {
  if (refPrice >= 100) return Math.round(val * 100) / 100;
  if (refPrice >= 1) return Math.round(val * 1000) / 1000;
  if (refPrice >= 0.01) return Math.round(val * 10000) / 10000;
  return Math.round(val * 10000000) / 10000000;
}

function formatNum(val: number, refPrice: number): string {
  if (refPrice >= 1000) {
    return val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (refPrice >= 1) {
    return val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  return val.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export async function getTradingAnalysis(symbol: string): Promise<TradingAnalysis> {
  const sym = symbol.toUpperCase().trim();

  // 1. Lokales Backend via apiFetch
  try {
    const res = await apiFetch(`/api/analysis/${sym}`);
    if (res.ok) return await res.json();
  } catch {
    // Weiter mit direktem Binance Aufruf
  }

  // 2. Direkter Aufruf
  const [klines15m, klines1h] = await Promise.all([
    binanceGet('/klines', { symbol: sym, interval: '15m', limit: 40 }),
    binanceGet('/klines', { symbol: sym, interval: '1h', limit: 40 })
  ]);

  const closes15m = klines15m.map((k: any) => parseFloat(k[4]));
  const closes1h = klines1h.map((k: any) => parseFloat(k[4]));
  const currentPrice = closes15m[closes15m.length - 1];

  const rsi15m = calculateRSI(closes15m, 14);
  const rsi1h = calculateRSI(closes1h, 14);

  const recentHighs = klines1h.slice(-24).map((k: any) => parseFloat(k[2]));
  const recentLows = klines1h.slice(-24).map((k: any) => parseFloat(k[3]));

  let resistance1 = smartRound(Math.max(...recentHighs), currentPrice);
  let support1 = smartRound(Math.min(...recentLows), currentPrice);

  let rangeSpan = resistance1 - support1;
  if (rangeSpan <= 0 || rangeSpan < currentPrice * 0.015) {
    rangeSpan = currentPrice * 0.035;
    resistance1 = smartRound(currentPrice * 1.025, currentPrice);
    support1 = smartRound(currentPrice * 0.975, currentPrice);
  }

  // Range Position in % (0% = Support-Boden, 100% = Resistance-Widerstand)
  const rawRangePos = ((currentPrice - support1) / rangeSpan) * 100;
  const rangePositionPct = Math.min(100, Math.max(0, Math.round(rawRangePos * 10) / 10));

  // Optimale Kauf-Range Definition: Unteres Drittel der Range (0% bis 33%)
  const buyRangeMin = smartRound(support1 * 0.998, currentPrice);
  const buyRangeMax = smartRound(support1 + (rangeSpan * 0.33), currentPrice);
  const buyRangeLabel = `${formatNum(buyRangeMin, currentPrice)} - ${formatNum(buyRangeMax, currentPrice)}`;

  // Abstand zur Kauf-Range
  const distanceToBuyPct = currentPrice <= buyRangeMax
    ? 0
    : Math.round(((currentPrice - buyRangeMax) / currentPrice) * 10000) / 100;

  const distanceToSupPct = Math.round((Math.abs(currentPrice - support1) / currentPrice) * 10000) / 100;
  const distanceToResPct = Math.round((Math.abs(resistance1 - currentPrice) / currentPrice) * 10000) / 100;

  // Statusbezeichnung
  let rangeStatus = '🟡 KONSOLIDIERUNG / MITTE';
  if (rangePositionPct <= 33) {
    rangeStatus = '🟢 KAUF-ZONE (DIP / AKKUMULATION)';
  } else if (rangePositionPct >= 70) {
    rangeStatus = '🔴 WIDERSTANDSZIELE / VERKAUF';
  }

  // Standard-Parameter fuer neutrale Konsolidierung
  let signal: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  let signalLabel = 'LIMIT-KAUF VORBEREITEN';
  let setupType = 'Pullback-Order in Kauf-Range';
  let entryTarget = smartRound(support1 + rangeSpan * 0.15, currentPrice);
  let entryMin = buyRangeMin;
  let entryMax = buyRangeMax;
  let stopLoss = smartRound(support1 * 0.991, currentPrice);
  let takeProfit1 = smartRound(support1 + rangeSpan * 0.55, currentPrice);
  let takeProfit2 = smartRound(resistance1 * 0.995, currentPrice);
  let confidence = '8/10';
  let rationale = `Kurs konsolidiert in der Range-Mitte (${rangePositionPct}%). Nicht teuer ueber Marktpreise kaufen, sondern Kauflimits in der Kauf-Range (${buyRangeLabel}) staffeln (Abstand: +${distanceToBuyPct}%).`;

  // 1. KAUF-SIGNAL A: In Kaufzone & Dip/Oversold Reversal
  if ((rangePositionPct <= 33 || distanceToSupPct <= 2.2) && rsi15m <= 44) {
    signal = 'BUY';
    signalLabel = 'KAUFEN (DIP-REVERSAL)';
    setupType = 'Support-Bounce / Oversold Dip-Kauf';
    entryTarget = smartRound(currentPrice, currentPrice);
    entryMin = buyRangeMin;
    entryMax = smartRound(Math.max(currentPrice, buyRangeMax), currentPrice);
    stopLoss = smartRound(support1 * 0.991, currentPrice);
    takeProfit1 = smartRound(support1 + rangeSpan * 0.55, currentPrice);
    takeProfit2 = smartRound(resistance1 * 0.995, currentPrice);
    confidence = '9/10';
    rationale = `Kurs notiert mit ${rangePositionPct}% direkt in der optimalen Kauf-Range (${buyRangeLabel}). RSI 15m (${rsi15m}) zeigt ideales Reversal-Niveau mit starkem CRV.`;
  }
  // 2. KAUF-SIGNAL B: In Kaufzone & Akkumulation (Unterstes Drittel)
  else if (rangePositionPct <= 35 && rsi15m <= 58) {
    signal = 'BUY';
    signalLabel = 'KAUFEN (AKKUMULATIONS-ZONE)';
    setupType = 'Range-Bottom Akkumulation';
    entryTarget = smartRound(currentPrice, currentPrice);
    entryMin = buyRangeMin;
    entryMax = buyRangeMax;
    stopLoss = smartRound(support1 * 0.991, currentPrice);
    takeProfit1 = smartRound(support1 + rangeSpan * 0.55, currentPrice);
    takeProfit2 = smartRound(resistance1 * 0.995, currentPrice);
    confidence = '8/10';
    rationale = `Kurs befindet sich im unteren Drittel der Handelsspanne (${rangePositionPct}% vom Support). Sehr guenstiges Niveau zur Akkumulation vor dem naechsten Impuls.`;
  }
  // 3. KAUF-SIGNAL C: Breakout Momentum Long
  else if (currentPrice >= resistance1 * 0.988 && rsi15m >= 56 && rsi1h >= 50) {
    signal = 'BUY';
    signalLabel = 'KAUFEN (BREAKOUT-MOMENTUM)';
    setupType = 'Widerstands-Ausbruch / Trendfolge';
    entryTarget = smartRound(currentPrice, currentPrice);
    entryMin = smartRound(resistance1 * 0.992, currentPrice);
    entryMax = smartRound(resistance1 * 1.008, currentPrice);
    stopLoss = smartRound(resistance1 * 0.985, currentPrice);
    takeProfit1 = smartRound(resistance1 * 1.025, currentPrice);
    takeProfit2 = smartRound(resistance1 * 1.055, currentPrice);
    confidence = '8/10';
    rationale = `Kurs bricht dynamisch an der oberen Range-Kante aus (RSI 15m: ${rsi15m}). Starkes Momentum; Trendfolge-Kauf mit engem Stop unter Ausbruchskante.`;
  }
  // 4. VERKAUF-SIGNAL: Oberes Range-Band / Widerstand
  else if (rangePositionPct >= 72 || (rsi15m >= 68 && distanceToResPct < 2.0)) {
    signal = 'SELL';
    signalLabel = 'GEWINNMITNAHME / WIDERSTAND';
    setupType = 'Resistance-Rejection / Overbought Fade';
    entryTarget = smartRound(resistance1 * 0.997, currentPrice);
    entryMin = smartRound(resistance1 * 0.992, currentPrice);
    entryMax = smartRound(resistance1 * 1.005, currentPrice);
    stopLoss = smartRound(resistance1 * 1.012, currentPrice);
    takeProfit1 = smartRound(support1 + rangeSpan * 0.5, currentPrice);
    takeProfit2 = smartRound(buyRangeMax, currentPrice);
    confidence = '8/10';
    rationale = `Kurs ist im oberen Range-Bereich (${rangePositionPct}%). RSI (${rsi15m}) signalisiert Ueberhitzung. Gewinne sichern; Neukauf erst wieder in der Kauf-Range (${buyRangeLabel}).`;
  }

  const risk = Math.abs(entryTarget - stopLoss);
  const reward1 = Math.abs(takeProfit1 - entryTarget);
  const reward2 = Math.abs(takeProfit2 - entryTarget);
  const crv1 = risk > 0 ? Math.round((reward1 / risk) * 100) / 100 : 1.5;
  const crv2 = risk > 0 ? Math.round((reward2 / risk) * 100) / 100 : 2.8;

  return {
    symbol: sym,
    current_price: currentPrice,
    signal,
    signal_label: signalLabel,
    confidence,
    rsi_15m: rsi15m,
    rsi_1h: rsi1h,
    support_level: support1,
    resistance_level: resistance1,
    range_position_pct: rangePositionPct,
    range_status: rangeStatus,
    buy_range_min: buyRangeMin,
    buy_range_max: buyRangeMax,
    buy_range_label: buyRangeLabel,
    distance_to_buy_pct: distanceToBuyPct,
    trade_setup: {
      setup_name: setupType,
      entry_zone: `${entryMin} - ${entryMax}`,
      buy_range_min: buyRangeMin,
      buy_range_max: buyRangeMax,
      buy_range_label: buyRangeLabel,
      range_position_pct: rangePositionPct,
      range_status: rangeStatus,
      distance_to_buy_pct: distanceToBuyPct,
      stop_loss: stopLoss,
      stop_loss_pct: Math.round((Math.abs(stopLoss - currentPrice) / currentPrice) * 10000) / 100,
      take_profit_1: takeProfit1,
      take_profit_1_pct: Math.round((Math.abs(takeProfit1 - currentPrice) / currentPrice) * 10000) / 100,
      take_profit_2: takeProfit2,
      take_profit_2_pct: Math.round((Math.abs(takeProfit2 - currentPrice) / currentPrice) * 10000) / 100,
      crv: `${crv2} : 1 (Ziel TP2)`,
      crv_tp1: `${crv1} : 1`,
      tactical_rationale: rationale
    }
  };
}

export async function getChartKlines(symbol: string, interval = '15m', limit = 55): Promise<KlineData[]> {
  const sym = symbol.toUpperCase().trim();

  // 1. Lokales Backend via apiFetch
  try {
    const res = await apiFetch(`/api/klines/${sym}?interval=${interval}&limit=${limit}`);
    if (res.ok) return await res.json();
  } catch {
    // Weiter
  }

  // 2. Binance API
  const rawKlines = await binanceGet('/klines', { symbol: sym, interval, limit });
  return rawKlines.map((k: any) => ({
    time: Number(k[0]),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    close_time: Number(k[6])
  }));
}

let BEST_PICK_CACHE_TIME = 0;
let BEST_PICK_CACHE_DATA: BestPickResponse | null = null;

export async function getBestPick(): Promise<BestPickResponse> {
  const now = Date.now();
  if (BEST_PICK_CACHE_DATA && now - BEST_PICK_CACHE_TIME < 15000) {
    return BEST_PICK_CACHE_DATA;
  }

  // 1. Blitzschneller Abruf ueber Backend apiFetch (5ms)
  try {
    const res = await apiFetch('/api/best-pick');
    if (res.ok) {
      const json = await res.json();
      BEST_PICK_CACHE_DATA = json;
      BEST_PICK_CACHE_TIME = now;
      return json;
    }
  } catch {
    // Weiter
  }

  // 2. Schnelle parallele Client-Berechnung ueber maximal 4 Haupt-Coins (nie blockieren)
  const evaluatedCoins: BestPick[] = [];
  const topCandidates = COINS_CATALOG.slice(0, 4);

  const settled = await Promise.allSettled(
    topCandidates.map(async (item) => {
      const sym = item.symbol;
      const [analysis, ticker] = await Promise.all([
        getTradingAnalysis(sym),
        binanceGet('/ticker/24hr', { symbol: sym })
      ]);
      return { item, analysis, ticker };
    })
  );

  for (const res of settled) {
    if (res.status !== 'fulfilled') continue;
    const { item, analysis, ticker } = res.value;
    try {
      const sym = item.symbol;
      const price24hPct = parseFloat(ticker.priceChangePercent);
    let score = 50.0;
    const reasons: string[] = [];

      const rsi = analysis.rsi_15m;
      if (rsi < 30) {
        score += 30.0;
        reasons.push(`Stark ueberverkauft (RSI 15m: ${rsi})`);
      } else if (rsi < 40) {
        score += 18.0;
        reasons.push(`Attraktiver Dip-Bereich (RSI 15m: ${rsi})`);
      } else if (rsi > 70) {
        score -= 30.0;
        reasons.push(`Ueberkauft (RSI 15m: ${rsi})`);
      }

      // 2. Naehe zur optimalen Kauf-Range und Support
      const rangePos = analysis.range_position_pct ?? 50;
      if (rangePos <= 22) {
        score += 30.0;
        reasons.push(`Direkt am Range-Boden (${rangePos}% der Handelsspanne)`);
      } else if (rangePos <= 35) {
        score += 22.0;
        reasons.push(`In der optimalen Kauf-Range (${rangePos}% der Handelsspanne)`);
      } else if (rangePos > 72) {
        score -= 25.0;
        reasons.push(`Nahe oberem Range-Widerstand (${rangePos}%)`);
      }

      if (analysis.distance_to_buy_pct === 0) {
        score += 15.0;
        reasons.push('Bereits in der Kauf-Zone');
      } else if (analysis.distance_to_buy_pct && analysis.distance_to_buy_pct <= 1.5) {
        score += 8.0;
        reasons.push(`Nur +${analysis.distance_to_buy_pct}% bis zur Kauf-Range`);
      }

      // 3. Signal-Bonus
      if (analysis.signal === 'BUY') {
        score += 25.0;
        reasons.push(`Signal: ${analysis.signal_label}`);
      } else if (analysis.signal === 'SELL') {
        score -= 35.0;
      }

      const setup = analysis.trade_setup;
      const tp2Pct = setup.take_profit_2_pct || 0;
      const slPct = setup.stop_loss_pct || 1;
      if (slPct > 0) {
        const crvCalc = tp2Pct / slPct;
        if (crvCalc >= 2.5) {
          score += 15.0;
          reasons.push(`Starkes CRV (${setup.crv})`);
        }
      }

      const finalScore = Math.max(5.0, Math.min(99.0, Math.round(score * 10) / 10));

      evaluatedCoins.push({
        symbol: sym,
        coin: item.coin,
        name: item.name,
        category: item.category,
        current_price: analysis.current_price,
        change_24h_pct: price24hPct,
        score: finalScore,
        signal: analysis.signal,
        signal_label: analysis.signal_label,
        rsi_15m: rsi,
        entry_zone: setup.entry_zone,
        buy_range_min: analysis.buy_range_min,
        buy_range_max: analysis.buy_range_max,
        buy_range_label: analysis.buy_range_label,
        range_position_pct: analysis.range_position_pct,
        range_status: analysis.range_status,
        distance_to_buy_pct: analysis.distance_to_buy_pct,
        stop_loss: setup.stop_loss,
        take_profit_1: setup.take_profit_1,
        take_profit_2: setup.take_profit_2,
        crv: setup.crv,
        reasons,
        tactical_rationale: setup.tactical_rationale
      });
    } catch {
      continue;
    }
  }

  evaluatedCoins.sort((a, b) => b.score - a.score);

  const result: BestPickResponse = {
    best_pick: evaluatedCoins[0] || null,
    ranking: evaluatedCoins.slice(0, 4),
    generated_at: new Date().toLocaleTimeString('de-DE')
  };

  BEST_PICK_CACHE_TIME = now;
  BEST_PICK_CACHE_DATA = result;
  return result;
}

export async function getTradingBotStatus(): Promise<BotStatus> {
  try {
    const res = await apiFetch('/api/trading/status');
    if (!res.ok) {
      return { configured: false, connected: false, usdt_free: 0, balances: [], error: 'Backend nicht erreichbar' };
    }
    const json = await res.json();
    if (!json.configured) {
      return { configured: false, connected: false, usdt_free: 0, balances: [], message: json.message };
    }
    const data = json.data || {};
    return {
      configured: true,
      connected: json.connected ?? false,
      usdt_free: data.usdt_free ?? 0,
      balances: data.balances ?? []
    };
  } catch (err: any) {
    return { configured: false, connected: false, usdt_free: 0, balances: [], error: err.message };
  }
}

export async function executeOrder(payload: {
  symbol: string;
  side: 'BUY' | 'SELL';
  order_type?: 'MARKET' | 'LIMIT';
  quote_order_qty?: number;
  quantity?: number;
  price?: number;
}): Promise<any> {
  const res = await apiFetch('/api/trading/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: payload.symbol,
      side: payload.side,
      order_type: payload.order_type || 'MARKET',
      quote_order_qty: payload.quote_order_qty,
      quantity: payload.quantity,
      price: payload.price
    })
  });
  if (!res.ok) {
    throw new Error(`Fehler bei Orderausfuehrung (${res.status})`);
  }
  return await res.json();
}

export async function getServerBotStatus(): Promise<ServerBotStatus | null> {
  try {
    const res = await apiFetch('/api/bot/status');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function toggleServerBot(enabled: boolean): Promise<ServerBotStatus | null> {
  try {
    const res = await apiFetch('/api/bot/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function updateServerBotConfig(config: any): Promise<any> {
  try {
    const res = await apiFetch('/api/bot/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function closeServerBotPosition(positionId: string): Promise<any> {
  const res = await apiFetch('/api/bot/close-position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position_id: positionId })
  });
  if (!res.ok) {
    throw new Error(`Fehler beim Schliessen der Position (${res.status})`);
  }
  return await res.json();
}

export async function getServerBotJournal(): Promise<TradeJournalEntry[]> {
  try {
    const res = await apiFetch('/api/bot/journal');
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}


