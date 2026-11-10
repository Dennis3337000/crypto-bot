import React from 'react';
import { BestPick } from '../types';

interface TopBuyBannerProps {
  bestPick: BestPick | null;
  ranking: BestPick[];
  selectedSymbol: string;
  onSelectCoin: (symbol: string) => void;
  formatPrice: (val?: number) => string;
}

export const TopBuyBanner: React.FC<TopBuyBannerProps> = ({
  bestPick,
  ranking,
  selectedSymbol,
  onSelectCoin,
  formatPrice
}) => {
  if (!bestPick) return null;

  const isSelected = selectedSymbol === bestPick.symbol;

  return (
    <div className="top-buy-container">
      <div className="top-buy-glow"></div>
      
      <div className="top-buy-header">
        <div className="top-buy-title-group">
          <span className="radar-icon">🎯</span>
          <div>
            <div className="top-buy-badge">KI-MARKT-RADAR: BESTER KAUF-KANDIDAT JETZT</div>
            <div className="top-buy-subtitle">Echtzeit-Scann aller Krypto-Paare nach optimalem Chance-Risiko-Verhältnis (CRV) & Support-Bounce</div>
          </div>
        </div>

        <div className="score-badge">
          <span className="score-num">{bestPick.score}</span>
          <span className="score-max">/100 KAUF-SCORE</span>
        </div>
      </div>

      <div className="top-buy-body">
        {/* Hauptkandidat Info */}
        <div className="best-pick-main">
          <div className="best-pick-coin-info">
            <div className="coin-avatar">{bestPick.coin.slice(0, 3)}</div>
            <div>
              <div className="coin-name-row">
                <span className="coin-symbol-large">{bestPick.coin}</span>
                <span className="coin-full-name">{bestPick.name}</span>
                <span className={`mini-signal-tag ${bestPick.signal}`}>
                  {bestPick.signal === 'BUY' && '🟢 '}
                  {bestPick.signal === 'WAIT' && '🟡 '}
                  {bestPick.signal === 'SELL' && '🔴 '}
                  {bestPick.signal_label}
                </span>
              </div>
              <div className="coin-category-text">{bestPick.category}</div>
            </div>
          </div>

          <div className="best-pick-metrics">
            <div className="metric-item">
              <span className="metric-label">Aktueller Kurs</span>
              <span className="metric-val">${formatPrice(bestPick.current_price)}</span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Optimale Kauf-Range</span>
              <span className="metric-val highlight-val">${bestPick.buy_range_label || bestPick.entry_zone}</span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Range-Position</span>
              <span className={`metric-val ${(bestPick.range_position_pct ?? 50) <= 35 ? 'text-green' : 'text-gold'}`}>
                {bestPick.range_position_pct !== undefined ? `${bestPick.range_position_pct}%` : 'Boden'}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">Abstand zur Kauf-Zone</span>
              <span className={`metric-val ${bestPick.distance_to_buy_pct === 0 ? 'text-green' : 'text-cyan'}`}>
                {bestPick.distance_to_buy_pct === 0 ? '✓ In Kaufzone' : `+${bestPick.distance_to_buy_pct}%`}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">CRV (Setup)</span>
              <span className="metric-val text-cyan">{bestPick.crv}</span>
            </div>
          </div>
        </div>

        {/* Gründe & Button */}
        <div className="best-pick-action-col">
          <div className="reasons-tags">
            {bestPick.reasons.map((r, i) => (
              <span key={i} className="reason-tag">✓ {r}</span>
            ))}
          </div>

          <button
            onClick={() => onSelectCoin(bestPick.symbol)}
            className={`select-best-btn ${isSelected ? 'active-selected' : ''}`}
          >
            {isSelected ? '✓ DIESER COIN WIRD GERADE ANALYSIERT' : `⚡ ${bestPick.coin} IM TERMINAL LADEN & TRADE PRÜFEN`}
          </button>
        </div>
      </div>

      {/* Alternative Top-Kandidaten (Platz 2, 3, 4) */}
      {ranking.length > 1 && (
        <div className="runners-up-row">
          <span className="runners-up-title">Weitere heiße Setups:</span>
          <div className="runners-up-list">
            {ranking.slice(1, 4).map((item, idx) => (
              <button
                key={item.symbol}
                onClick={() => onSelectCoin(item.symbol)}
                className={`runner-chip ${selectedSymbol === item.symbol ? 'active' : ''}`}
              >
                <span className="runner-rank">#{idx + 2}</span>
                <span className="runner-coin">{item.coin}</span>
                <span className="runner-score">{item.score} Pkt</span>
                <span className="runner-price">${formatPrice(item.current_price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
