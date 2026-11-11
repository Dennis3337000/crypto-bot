import React from 'react';
import { ServerBotStatus, ActivePosition } from '../types';

interface TopPortfolioBarProps {
  serverBot: ServerBotStatus | null;
  onSelectCoin: (symbol: string) => void;
  formatPrice: (val?: number) => string;
}

export const TopPortfolioBar: React.FC<TopPortfolioBarProps> = ({
  serverBot,
  onSelectCoin,
  formatPrice
}) => {
  const openPositions: ActivePosition[] = serverBot?.open_positions || [];
  const totalTrades = serverBot?.total_trades || 0;
  const totalPnl = serverBot?.total_pnl_usdt || 0;
  const winRate = serverBot?.win_rate_pct || 0;
  
  const initialCap = serverBot?.initial_capital_usdt ?? 10000.0;
  const totalMarginSpent = openPositions.reduce(
    (sum, p) => sum + (p.margin_spent || p.quote_spent || 0),
    0
  );
  const usdtFree = serverBot?.usdt_free ?? Math.max(0, initialCap - totalMarginSpent);
  const positionsValue = serverBot?.positions_value_usdt ?? totalMarginSpent;
  const totalCapital = serverBot?.total_capital_usdt ?? Math.round((usdtFree + totalPnl) * 100) / 100;
  const capitalGrowth = serverBot?.capital_growth_pct ?? (initialCap > 0 ? (totalPnl / initialCap) * 100 : 0);

  const totalFloatingPnl = openPositions.reduce(
    (sum, p) => sum + (p.unrealized_pnl_usdt || 0),
    0
  );

  return (
    <div className="top-portfolio-bar">
      {/* 1. OFFENE TRADES (LIVE POSITIONEN) */}
      <div className="portfolio-kpi-card">
        <div className="kpi-card-header">
          <div className="kpi-tag-title">
            <span className="kpi-icon">💼</span>
            <span>OFFENE TRADES ({openPositions.length})</span>
          </div>
          <span className={`kpi-status-badge ${openPositions.length > 0 ? 'active' : 'idle'}`}>
            {openPositions.length > 0 ? `${openPositions.length} AKTIV` : 'SCANNT MARKT'}
          </span>
        </div>

        <div className="kpi-main-content">
          {openPositions.length === 0 ? (
            <div className="kpi-empty-text">
              <span>Keine offenen Positionen</span>
              <span className="kpi-sub-hint">24/7 Bot sucht Kaufchancen</span>
            </div>
          ) : (
            <div className="open-trades-chips">
              {openPositions.map((pos) => {
                const pnl = pos.unrealized_pnl_usdt || 0;
                const roi = pos.unrealized_roi_pct || 0;
                const isPos = pnl >= 0;
                return (
                  <button
                    key={pos.id}
                    onClick={() => onSelectCoin(pos.symbol)}
                    className={`open-trade-chip ${isPos ? 'chip-green' : 'chip-red'}`}
                    title={`Klick um ${pos.coin} im Terminal zu öffnen`}
                  >
                    <span className="otc-coin">{pos.coin}</span>
                    <span className={`otc-pnl ${isPos ? 'text-green' : 'text-red'}`}>
                      {isPos ? '+' : ''}{roi.toFixed(1)}%
                    </span>
                    <span className="otc-val">
                      ${formatPrice(pos.current_price || pos.entry_price)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="kpi-card-footer">
          <span>Laufender Gewinn (Floating):</span>
          <strong className={totalFloatingPnl >= 0 ? 'text-green' : 'text-red'}>
            {totalFloatingPnl >= 0 ? '+' : ''}${totalFloatingPnl.toFixed(2)} USDT
          </strong>
        </div>
      </div>

      {/* 2. VOM BOT VERDIENT (REALISIERTER GESAMT-PNL) */}
      <div className="portfolio-kpi-card">
        <div className="kpi-card-header">
          <div className="kpi-tag-title">
            <span className="kpi-icon">📈</span>
            <span>VOM BOT VERDIENT</span>
          </div>
          <span className="kpi-winrate-badge">
            {winRate}% WIN-RATE
          </span>
        </div>

        <div className="kpi-main-content">
          <div className="kpi-highlight-number-row">
            <span className={`kpi-big-value ${totalPnl >= 0 ? 'text-green' : 'text-red'}`}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </span>
            <span className="kpi-currency">USDT</span>
          </div>
          <div className="kpi-sub-hint">
            Realisierter Reingewinn aus abgeschlossenen Trades
          </div>
        </div>

        <div className="kpi-card-footer">
          <span>Abgeschlossene Trades:</span>
          <strong>{totalTrades} Trades ({winRate}% Quote)</strong>
        </div>
      </div>

      {/* 3. GESAMTKAPITAL (PORTFOLIO-WERT) */}
      <div className="portfolio-kpi-card highlight-card">
        <div className="kpi-card-header">
          <div className="kpi-tag-title">
            <span className="kpi-icon">💰</span>
            <span>GESAMTKAPITAL (PORTFOLIO)</span>
          </div>
          <span className={`kpi-growth-badge ${capitalGrowth >= 0 ? 'positive' : 'negative'}`}>
            {capitalGrowth >= 0 ? '+' : ''}{capitalGrowth.toFixed(2)}%
          </span>
        </div>

        <div className="kpi-main-content">
          <div className="kpi-highlight-number-row">
            <span className="kpi-big-value text-cyan">
              ${totalCapital.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="kpi-currency">USDT</span>
          </div>
          <div className="kpi-sub-hint">
            Freies Restguthaben + bisher vom Bot verdient
          </div>
        </div>

        <div className="kpi-card-footer">
          <span>Verfügbar (übrig): <strong>${usdtFree.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
          <span>• Vom Bot verdient: <strong className={totalPnl >= 0 ? 'text-green' : 'text-red'}>{totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT</strong></span>
          {positionsValue > 0 && <span> • In Trades: <strong>${positionsValue.toFixed(2)}</strong></span>}
        </div>
      </div>
    </div>
  );
};
