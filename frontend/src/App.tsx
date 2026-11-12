import React, { useState, useEffect } from 'react';
import { CoinItem, MarketData, TradingAnalysis, BestPick, ServerBotStatus } from './types';
import { TopBuyBanner } from './components/TopBuyBanner';
import { AutoTradingPanel } from './components/AutoTradingPanel';
import { TopPortfolioBar } from './components/TopPortfolioBar';
import { LoginModal } from './components/LoginModal';
import { getCoins, getMarketData, getTradingAnalysis, getBestPick, getServerBotStatus, getLivePrices, getAuthToken, verifyAuth, logoutUser } from './binanceService';

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return Boolean(getAuthToken());
  });
  const [coins, setCoins] = useState<CoinItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [analysis, setAnalysis] = useState<TradingAnalysis | null>(null);
  const [bestPick, setBestPick] = useState<BestPick | null>(null);
  const [ranking, setRanking] = useState<BestPick[]>([]);
  const [serverBot, setServerBot] = useState<ServerBotStatus | null>(() => {
    try {
      const cached = localStorage.getItem('crypto_server_bot_status');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  // Authentifizierung beim Start validieren
  useEffect(() => {
    verifyAuth().then((valid) => {
      setIsAuthenticated(valid);
    });
  }, []);

  // Coins List laden
  useEffect(() => {
    getCoins()
      .then((data: CoinItem[]) => {
        setCoins(data);
      })
      .catch((err) => {
        console.error(err);
      });
  }, []);

  // Server Bot Status abrufen
  const loadBotStatus = async () => {
    try {
      const status = await getServerBotStatus();
      if (status) {
        setServerBot(status);
        try {
          localStorage.setItem('crypto_server_bot_status', JSON.stringify(status));
        } catch {}
      }
    } catch (err) {
      console.error('Fehler beim Laden des Bot-Status:', err);
    }
  };

  useEffect(() => {
    loadBotStatus();
  }, []);

  // Schnelle Live-Preisaktualisierung für alle offenen Trades (alle 3 Sekunden)
  useEffect(() => {
    if (!serverBot || !serverBot.open_positions || serverBot.open_positions.length === 0) return;

    const interval = setInterval(async () => {
      const positions = serverBot.open_positions || [];
      if (positions.length === 0) return;

      const symbols = positions.map((p) => p.symbol);
      const prices = await getLivePrices(symbols);
      if (!prices || Object.keys(prices).length === 0) return;

      setServerBot((prev) => {
        if (!prev || !prev.open_positions) return prev;
        let changed = false;
        const updatedPositions = prev.open_positions.map((pos) => {
          const livePrice = prices[pos.symbol];
          if (livePrice && Math.abs(livePrice - (pos.current_price || 0)) > 0.0000001) {
            changed = true;
            const entry = pos.entry_price || livePrice;
            const lev = pos.leverage || 1;
            const margin = pos.margin_spent || pos.quote_spent || 50;
            const rawRoi = entry > 0 ? (livePrice - entry) / entry : 0;
            const baseRoi = Math.max(-0.35, Math.min(0.35, rawRoi));
            const roiPct = Math.round(baseRoi * 100 * lev * 100) / 100;
            const pnlUsdt = Math.round(margin * baseRoi * lev * 100) / 100;
            const peak = Math.max(pos.peak_price || entry, livePrice);
            return {
              ...pos,
              current_price: livePrice,
              unrealized_roi_pct: roiPct,
              unrealized_pnl_usdt: pnlUsdt,
              peak_price: peak
            };
          }
          return pos;
        });

        if (!changed) return prev;

        const totalMargin = updatedPositions.reduce((sum, p) => sum + (p.margin_spent || p.quote_spent || 0), 0);
        const totalUnrealized = updatedPositions.reduce((sum, p) => sum + (p.unrealized_pnl_usdt || 0), 0);
        const posValue = Math.round((totalMargin + totalUnrealized) * 100) / 100;
        const initialCap = prev.initial_capital_usdt ?? 10000.0;
        const remainingUsdt = Math.round(Math.max(0, initialCap - totalMargin) * 100) / 100;
        const totalCap = Math.round((remainingUsdt + (prev.total_pnl_usdt || 0)) * 100) / 100;

        return {
          ...prev,
          open_positions: updatedPositions,
          positions_value_usdt: posValue,
          usdt_free: remainingUsdt,
          total_capital_usdt: totalCap
        };
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [serverBot?.open_positions?.length]);

  // Best-Pick (Top-Kaufempfehlung) laden
  const loadBestPick = async () => {
    try {
      const data = await getBestPick();
      setBestPick(data.best_pick);
      setRanking(data.ranking || []);
    } catch (err) {
      console.error('Fehler beim Laden der Kauf-Empfehlung:', err);
    }
  };

  useEffect(() => {
    loadBestPick();
  }, []);

  // Daten abrufen für den gewählten Coin
  const loadCoinData = async (symbol: string, isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const [marketJson, analysisJson] = await Promise.all([
        getMarketData(symbol),
        getTradingAnalysis(symbol)
      ]);

      setMarketData(marketJson);
      setAnalysis(analysisJson);
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error('Ladefehler:', err);
      setError(err.message || 'Fehler beim Abrufen der Marktdaten von Binance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadCoinData(selectedSymbol);
  }, [selectedSymbol]);

  // Auto-Refresh Intervall (alle 10 Sekunden)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadCoinData(selectedSymbol, true);
      loadBestPick();
      loadBotStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedSymbol, autoRefresh]);

  const formatPrice = (val?: number) => {
    if (val === undefined || val === null) return '---';
    if (val >= 1000) {
      return val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (val >= 1) {
      return val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    return val.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  };

  const formatPct = (val?: number) => {
    if (val === undefined || val === null) return '0.00%';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}%`;
  };

  const getDeltaClass = (val?: number) => {
    if (!val) return '';
    return val >= 0 ? 'delta-pos' : 'delta-neg';
  };

  const currentCoinInfo = coins.find((c) => c.symbol === selectedSymbol) || {
    coin: selectedSymbol.replace('USDT', ''),
    name: selectedSymbol,
    category: 'Crypto Asset'
  };

  if (!isAuthenticated) {
    return <LoginModal onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="top-header">
        <div className="brand">
          <div className="brand-icon">⚡</div>
          <div className="brand-title">
            <h1>Crypto Scalp & Daytrading Terminal</h1>
            <div className="brand-subtitle">
              <span>Kurzzeit-Marktanalyse & KI-Trading-Signale</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="live-indicator">
            <span className="pulse-dot"></span>
            <span>{refreshing ? 'REFRESHING...' : 'LIVE TICKER'}</span>
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`chip-btn ${autoRefresh ? 'active' : ''}`}
            title="Automatisches Neuladen alle 10s an/aus"
          >
            {autoRefresh ? '⚡ Auto-Sync: An' : '⏸ Auto-Sync: Pause'}
          </button>

          <button
            onClick={async () => {
              await logoutUser();
              setIsAuthenticated(false);
            }}
            className="chip-btn"
            title="Terminal sperren / Abmelden"
            style={{ borderColor: 'rgba(255, 56, 96, 0.4)', color: 'var(--color-red)' }}
          >
            🔒 Abmelden
          </button>
        </div>
      </header>

      {/* 0. LIVE TOP-PORTFOLIO & OFFENE TRADES BAR (Vom Chef gewünscht) */}
      <TopPortfolioBar
        serverBot={serverBot}
        onSelectCoin={(sym) => setSelectedSymbol(sym)}
        formatPrice={formatPrice}
      />

      {/* 1. TOP BUY RECOMMENDATION BANNER (Vom Chef gewünscht: Bester Coin zum Kaufen) */}
      <TopBuyBanner
        bestPick={bestPick}
        ranking={ranking}
        selectedSymbol={selectedSymbol}
        onSelectCoin={(sym) => setSelectedSymbol(sym)}
        formatPrice={formatPrice}
      />

      {/* 2. Control Bar: Dropdown + Quick Selector */}
      <section className="controls-bar">
        <div className="selector-group">
          <label className="selector-label" htmlFor="coin-select">Coin wählen:</label>
          <select
            id="coin-select"
            className="coin-dropdown"
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
          >
            {coins.map((c) => (
              <option key={c.symbol} value={c.symbol}>
                {c.coin} - {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Quick Selection Buttons */}
        <div className="quick-chips">
          {coins.slice(0, 8).map((c) => (
            <button
              key={c.symbol}
              onClick={() => setSelectedSymbol(c.symbol)}
              className={`chip-btn ${selectedSymbol === c.symbol ? 'active' : ''}`}
            >
              {c.coin}
            </button>
          ))}
        </div>
      </section>

      {/* Fehleranzeige */}
      {error && (
        <div className="error-banner">
          <div>⚠️ {error}</div>
          <button
            onClick={() => loadCoinData(selectedSymbol)}
            className="chip-btn"
            style={{ borderColor: '#fff', color: '#fff' }}
          >
            Erneut versuchen
          </button>
        </div>
      )}

      {loading && !marketData ? (
        <div className="loading-box">
          <div className="spinner"></div>
          <p style={{ color: 'var(--text-muted)' }}>Lade Binance-Marktdaten für {selectedSymbol}...</p>
        </div>
      ) : marketData && analysis ? (
        <>
          {/* Hero Banner mit aktuellem Kurs */}
          <div className="hero-banner">
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-dim)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                {currentCoinInfo.name} ({currentCoinInfo.coin}/USDT) • {currentCoinInfo.category}
              </div>
              <div className="hero-left">
                <span className="current-price">
                  ${formatPrice(marketData.current_price)}
                </span>
                <span className="price-unit">USDT</span>
                <span className={`price-delta-24h ${getDeltaClass(marketData.stats_24h.change_pct)}`}>
                  {formatPct(marketData.stats_24h.change_pct)} (24h)
                </span>
              </div>
            </div>

            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                24h High: <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>${formatPrice(marketData.stats_24h.high)}</strong>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                24h Low: <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>${formatPrice(marketData.stats_24h.low)}</strong>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                Stand: {lastUpdated.toLocaleTimeString('de-DE')}
              </div>
            </div>
          </div>

          {/* 4. TRADING SIGNAL & SETUP (Das Herzstück für den Chef) */}
          <div className={`signal-box signal-${analysis.signal}`}>
            <div className="signal-header">
              <div className="signal-badge-wrapper">
                <span className={`signal-badge ${analysis.signal}`}>
                  {analysis.signal === 'BUY' && '🟢 '}
                  {analysis.signal === 'SELL' && '🔴 '}
                  {analysis.signal === 'WAIT' && '🟡 '}
                  {analysis.signal_label}
                </span>
                <span className="signal-setup-title">
                  {analysis.trade_setup.setup_name}
                </span>
              </div>

              <div className="signal-confidence">
                Konfidenz: <strong>{analysis.confidence}</strong> • Zeithorizont: Intraday / Scalp
              </div>
            </div>

            {/* NEU: TRADING-RANGE & KAUF-ZONEN RADAR */}
            <div className="range-radar-card">
              <div className="range-radar-header">
                <div className="range-radar-title">
                  <span className="radar-icon-pulse">🎯</span>
                  <strong>TRADING-RANGE & KAUF-ZONEN ANALYSE</strong>
                </div>
                <div className="range-radar-status">
                  <span className="status-label">Status:</span>
                  <span className="status-badge">{analysis.range_status || 'KAUF-ZONE'}</span>
                  <span className="range-pct-badge">{analysis.range_position_pct ?? 0}% im Kanal</span>
                </div>
              </div>

              {/* Visueller Range-Balken mit den 3 Zonen */}
              <div className="range-bar-wrapper">
                <div className="range-bar-track">
                  <div className="range-zone-segment zone-buy" title="Optimale Kauf-Range (Dip / Akkumulation)">
                    <span>🟢 KAUF-RANGE (0-33%)</span>
                  </div>
                  <div className="range-zone-segment zone-neutral" title="Neutrale Mitte (Konsolidierung)">
                    <span>🟡 MITTE / PULLBACK (33-70%)</span>
                  </div>
                  <div className="range-zone-segment zone-sell" title="Widerstand / Gewinnmitnahme">
                    <span>🔴 WIDERSTAND (70-100%)</span>
                  </div>

                  {/* Kurs-Nadel / Marker */}
                  <div
                    className="range-current-marker"
                    style={{ left: `${Math.min(98, Math.max(2, analysis.range_position_pct ?? 50))}%` }}
                  >
                    <div className="marker-pin"></div>
                    <div className="marker-tooltip">
                      ${formatPrice(marketData.current_price)} ({analysis.range_position_pct ?? 0}%)
                    </div>
                  </div>
                </div>

                {/* Achsen-Beschriftung Support & Resistance */}
                <div className="range-axis-labels">
                  <div className="axis-label-left">
                    <span className="axis-dim">Support:</span>
                    <strong>${formatPrice(analysis.support_level)}</strong>
                  </div>
                  <div className="axis-label-center">
                    <span className="axis-dim">Kauf-Range:</span>
                    <strong className="text-green">${analysis.buy_range_label || analysis.trade_setup.entry_zone}</strong>
                  </div>
                  <div className="axis-label-right">
                    <span className="axis-dim">Widerstand:</span>
                    <strong>${formatPrice(analysis.resistance_level)}</strong>
                  </div>
                </div>
              </div>

              {/* Schnelle Kennzahlen zur Kaufzone */}
              <div className="range-quick-metrics">
                <div className="range-metric-item">
                  <span className="rm-label">Optimale Kauf-Range:</span>
                  <span className="rm-val text-green">${analysis.buy_range_label || analysis.trade_setup.entry_zone}</span>
                </div>
                <div className="range-metric-item">
                  <span className="rm-label">Abstand zur Kaufzone:</span>
                  <span className={`rm-val ${analysis.distance_to_buy_pct === 0 ? 'text-green' : 'text-gold'}`}>
                    {analysis.distance_to_buy_pct === 0 ? '✓ Kurs ist in der Kauf-Range' : `+${analysis.distance_to_buy_pct}% bis Kaufzone`}
                  </span>
                </div>
                <div className="range-metric-item">
                  <span className="rm-label">Empfohlene Taktik:</span>
                  <span className="rm-val text-cyan">
                    {(analysis.range_position_pct ?? 50) <= 33
                      ? 'Sofort-Einstieg / Akkumulation'
                      : (analysis.range_position_pct ?? 50) <= 70
                      ? 'Limit-Order in Kauf-Range'
                      : 'Gewinne sichern / Short'}
                  </span>
                </div>
              </div>
            </div>

            {/* Setups Grid: Entry, SL, TP, CRV */}
            <div className="setup-grid">
              <div className="setup-tile buy-highlight">
                <div className="setup-tile-label">Optimale Kauf-Range</div>
                <div className="setup-tile-value text-green">${analysis.buy_range_label || analysis.trade_setup.entry_zone}</div>
                <div className="setup-tile-sub">
                  {analysis.distance_to_buy_pct === 0 ? '✓ Jetzt in Einstiegszone' : `Abstand: +${analysis.distance_to_buy_pct}%`}
                </div>
              </div>

              <div className="setup-tile sl-highlight">
                <div className="setup-tile-label">Stop-Loss (Kapitalschutz)</div>
                <div className="setup-tile-value">${formatPrice(analysis.trade_setup.stop_loss)}</div>
                <div className="setup-tile-sub">Abstand: -{analysis.trade_setup.stop_loss_pct}%</div>
              </div>

              <div className="setup-tile tp-highlight">
                <div className="setup-tile-label">Take-Profit 1 (Teilgewinn)</div>
                <div className="setup-tile-value">${formatPrice(analysis.trade_setup.take_profit_1)}</div>
                <div className="setup-tile-sub">Ziel 1: +{analysis.trade_setup.take_profit_1_pct}% (50% Schliessen)</div>
              </div>

              <div className="setup-tile tp-highlight">
                <div className="setup-tile-label">Take-Profit 2 (Hauptziel)</div>
                <div className="setup-tile-value">${formatPrice(analysis.trade_setup.take_profit_2)}</div>
                <div className="setup-tile-sub">Ziel 2: +{analysis.trade_setup.take_profit_2_pct}%</div>
              </div>

              <div className="setup-tile crv-highlight">
                <div className="setup-tile-label">Chance-Risiko-Verhältnis</div>
                <div className="setup-tile-value">{analysis.trade_setup.crv}</div>
                <div className="setup-tile-sub">TP1-CRV: {analysis.trade_setup.crv_tp1}</div>
              </div>
            </div>

            {/* Taktische Begründung */}
            <div className="signal-rationale">
              <strong>Taktische Einschätzung: </strong>
              {analysis.trade_setup.tactical_rationale}
            </div>
          </div>

          {/* 5. BINANCE TESTNET LIVE-TRADING & KI-AUTOPILOT */}
          <AutoTradingPanel
            selectedSymbol={selectedSymbol}
            coin={currentCoinInfo.coin}
            currentPrice={marketData.current_price}
            analysis={analysis}
            bestPick={bestPick}
            serverBot={serverBot}
            onRefreshBot={loadBotStatus}
            formatPrice={formatPrice}
          />

          {/* 6. ZUSÄTZLICHE INDIKATOREN & LEVELS */}
          <div className="indicators-row">
            {/* RSI 15m Gauge */}
            <div className="indicator-card">
              <div className="indicator-card-title">
                <span>RSI (15 Minuten - Momentum)</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>{analysis.rsi_15m}</span>
              </div>
              <div className="indicator-gauge-bar">
                <div
                  className="gauge-fill"
                  style={{
                    width: `${analysis.rsi_15m}%`,
                    backgroundColor: analysis.rsi_15m < 30 ? 'var(--color-green)' : analysis.rsi_15m > 70 ? 'var(--color-red)' : 'var(--color-cyan)'
                  }}
                ></div>
              </div>
              <div className="gauge-legend">
                <span>0 (Überverkauft)</span>
                <span>50</span>
                <span>100 (Überkauft)</span>
              </div>
            </div>

            {/* RSI 1h Gauge */}
            <div className="indicator-card">
              <div className="indicator-card-title">
                <span>RSI (1 Stunde - Trend)</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>{analysis.rsi_1h}</span>
              </div>
              <div className="indicator-gauge-bar">
                <div
                  className="gauge-fill"
                  style={{
                    width: `${analysis.rsi_1h}%`,
                    backgroundColor: analysis.rsi_1h < 30 ? 'var(--color-green)' : analysis.rsi_1h > 70 ? 'var(--color-red)' : 'var(--color-cyan)'
                  }}
                ></div>
              </div>
              <div className="gauge-legend">
                <span>0 (Überverkauft)</span>
                <span>50</span>
                <span>100 (Überkauft)</span>
              </div>
            </div>

            {/* Key Levels Card */}
            <div className="indicator-card">
              <div className="indicator-card-title">
                <span>Wichtige Zonen (Intraday)</span>
                <span>1h Chart-Struktur</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-red)' }}>Widerstand (Resistance):</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>${formatPrice(analysis.resistance_level)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-green)' }}>Unterstützung (Support):</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>${formatPrice(analysis.support_level)}</strong>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Footer */}
      <footer className="footer-note">
        <p>Crypto Trading Assistant & Scalping Terminal • Datenquelle: Binance Public REST API via lokaler Proxy-Architektur</p>
        <p style={{ marginTop: '4px' }}>Hinweis: Technische Marktanalyse für Daytrading. Diszipliniertes Risikomanagement und Stop-Loss-Setzung sind zwingend erforderlich.</p>
      </footer>
    </div>
  );
};
