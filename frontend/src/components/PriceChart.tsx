import React, { useState, useEffect, useRef } from 'react';
import { KlineData } from '../types';
import { getChartKlines } from '../binanceService';

interface PriceChartProps {
  symbol: string;
  currentPrice: number;
  supportLevel: number;
  resistanceLevel: number;
  buyRangeMin?: number;
  buyRangeMax?: number;
  formatPrice: (val?: number) => string;
}

export const PriceChart: React.FC<PriceChartProps> = ({
  symbol,
  currentPrice,
  supportLevel,
  resistanceLevel,
  buyRangeMin,
  buyRangeMax,
  formatPrice
}) => {
  const [interval, setInterval] = useState<string>('15m');
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const fetchKlines = async () => {
    setLoading(true);
    try {
      const data = await getChartKlines(symbol, interval, 55);
      setKlines(data);
    } catch (err) {
      console.error('Fehler beim Laden der Chartdaten:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKlines();
  }, [symbol, interval]);

  // Dimensionen für SVG
  const width = 1100;
  const height = 440;
  const padding = { top: 30, right: 80, bottom: 50, left: 20 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const volumeHeight = 70;
  const priceChartHeight = chartHeight - volumeHeight - 15;

  if (loading && klines.length === 0) {
    return (
      <div className="chart-container">
        <div className="chart-loading">
          <div className="spinner"></div>
          <span>Lade Chart für {symbol} ({interval})...</span>
        </div>
      </div>
    );
  }

  if (klines.length === 0) {
    return (
      <div className="chart-container">
        <div className="chart-loading">Keine Chartdaten verfügbar.</div>
      </div>
    );
  }

  // Preisskalierung berechnen
  const prices = klines.flatMap((k) => [k.low, k.high]);
  if (supportLevel > 0) prices.push(supportLevel);
  if (resistanceLevel > 0) prices.push(resistanceLevel);
  if (currentPrice > 0) prices.push(currentPrice);
  if (buyRangeMin && buyRangeMin > 0) prices.push(buyRangeMin);
  if (buyRangeMax && buyRangeMax > 0) prices.push(buyRangeMax);

  const minPrice = Math.min(...prices) * 0.9985;
  const maxPrice = Math.max(...prices) * 1.0015;
  const priceRange = maxPrice - minPrice || 1;

  const maxVolume = Math.max(...klines.map((k) => k.volume)) || 1;

  const getY = (val: number) => {
    return padding.top + (1 - (val - minPrice) / priceRange) * priceChartHeight;
  };

  const getVolY = (vol: number) => {
    const volRatio = vol / maxVolume;
    return padding.top + priceChartHeight + 15 + (1 - volRatio) * volumeHeight;
  };

  const candleStep = chartWidth / klines.length;
  const candleWidth = Math.max(3, candleStep * 0.7);

  // Aktive Hover-Kerze
  const activeCandle = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < klines.length
    ? klines[hoverIndex]
    : klines[klines.length - 1];

  const candleChangePct = activeCandle
    ? ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100
    : 0;

  // Mausbewegung über SVG
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;
    const relX = svgX - padding.left;

    if (relX >= 0 && relX <= chartWidth) {
      const idx = Math.floor(relX / candleStep);
      const clamped = Math.max(0, Math.min(klines.length - 1, idx));
      setHoverIndex(clamped);
    }
  };

  // Touch-Unterstützung für Mobilgeräte / Handy
  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const touchX = touch.clientX - rect.left;
      const svgX = (touchX / rect.width) * width;
      const relX = svgX - padding.left;

      if (relX >= 0 && relX <= chartWidth) {
        const idx = Math.floor(relX / candleStep);
        const clamped = Math.max(0, Math.min(klines.length - 1, idx));
        setHoverIndex(clamped);
      }
    }
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  // Koordinaten für Area / Line Path
  const linePoints = klines.map((k, i) => {
    const x = padding.left + i * candleStep + candleStep / 2;
    const y = getY(k.close);
    return `${x},${y}`;
  });

  const areaPoints = [
    `${padding.left + candleStep / 2},${padding.top + priceChartHeight}`,
    ...linePoints,
    `${padding.left + (klines.length - 1) * candleStep + candleStep / 2},${padding.top + priceChartHeight}`
  ].join(' ');

  // Y-Achsen Ticks (5 Ticks)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => minPrice + pct * priceRange);

  return (
    <div className="chart-card-wrapper" ref={containerRef}>
      {/* Chart Toolbar */}
      <div className="chart-toolbar">
        <div className="chart-title-group">
          <span className="chart-icon">📈</span>
          <span className="chart-main-title">{symbol} Interaktiver Preischart</span>
          <span className="chart-candle-count">({klines.length} Kerzen)</span>
        </div>

        {/* Timeframe & Mode Toggles */}
        <div className="chart-controls-group">
          <div className="timeframe-buttons">
            {(['15m', '1h', '4h', '1d'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setInterval(tf)}
                className={`tf-btn ${interval === tf ? 'active' : ''}`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="chart-mode-buttons">
            <button
              onClick={() => setChartType('candles')}
              className={`mode-btn ${chartType === 'candles' ? 'active' : ''}`}
              title="Kerzenchart (Candlestick)"
            >
              🕯 Kerzen
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`mode-btn ${chartType === 'line' ? 'active' : ''}`}
              title="Linienchart / Area"
            >
              📉 Linie
            </button>
          </div>
        </div>
      </div>

      {/* Info HUD Bar oberhalb des Charts */}
      {activeCandle && (
        <div className="chart-hud">
          <div className="hud-item">
            <span className="hud-label">ZEIT:</span>
            <span className="hud-val">{new Date(activeCandle.time).toLocaleString('de-DE')}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">OPEN:</span>
            <span className="hud-val">${formatPrice(activeCandle.open)}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">HIGH:</span>
            <span className="hud-val text-green">${formatPrice(activeCandle.high)}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">LOW:</span>
            <span className="hud-val text-red">${formatPrice(activeCandle.low)}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">CLOSE:</span>
            <span className="hud-val">${formatPrice(activeCandle.close)}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">CHANGE:</span>
            <span className={`hud-val ${candleChangePct >= 0 ? 'text-green' : 'text-red'}`}>
              {candleChangePct >= 0 ? '+' : ''}{candleChangePct.toFixed(2)}%
            </span>
          </div>
          <div className="hud-item">
            <span className="hud-label">VOLUMEN:</span>
            <span className="hud-val">{activeCandle.volume.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</span>
          </div>
        </div>
      )}

      {/* SVG SVG Interactive Chart Canvas */}
      <div className="svg-chart-container">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="trading-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchMove}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseLeave}
        >
          <defs>
            <linearGradient id="areaGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.35" />
              <stop offset="80%" stopColor="#00e5ff" stopOpacity="0.02" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="bullVolGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e676" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#00e676" stopOpacity="0.15" />
            </linearGradient>
            <linearGradient id="bearVolGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff3860" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#ff3860" stopOpacity="0.15" />
            </linearGradient>
          </defs>

          {/* Horizontale Rasterlinien (Grid) */}
          {yTicks.map((tickVal, i) => {
            const y = getY(tickVal);
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeDasharray="3,3"
                />
                <text
                  x={width - padding.right + 8}
                  y={y + 4}
                  fill="#78889b"
                  fontSize="11"
                  fontFamily="'JetBrains Mono', monospace"
                >
                  ${formatPrice(tickVal)}
                </text>
              </g>
            );
          })}

          {/* Kauf-Range Shaded Zone (Optimale Kaufzone) */}
          {buyRangeMin && buyRangeMax && buyRangeMax > buyRangeMin && (
            <g className="buy-range-chart-zone">
              <rect
                x={padding.left}
                y={getY(buyRangeMax)}
                width={width - padding.left - padding.right}
                height={Math.max(6, getY(buyRangeMin) - getY(buyRangeMax))}
                fill="rgba(0, 230, 118, 0.12)"
                stroke="#00e676"
                strokeWidth="1.2"
                strokeDasharray="4,4"
                strokeOpacity="0.7"
              />
              <rect
                x={padding.left + 10}
                y={getY(buyRangeMax) - 10}
                width="170"
                height="19"
                rx="4"
                fill="#00e676"
              />
              <text
                x={padding.left + 16}
                y={getY(buyRangeMax) + 3}
                fill="#05080e"
                fontSize="10"
                fontWeight="800"
                fontFamily="'JetBrains Mono', monospace"
              >
                KAUF-ZONE: ${formatPrice(buyRangeMin)} - ${formatPrice(buyRangeMax)}
              </text>
            </g>
          )}

          {/* Support Level Overlay (Grün gestrichelt) */}
          {supportLevel > 0 && (
            <g>
              <line
                x1={padding.left}
                y1={getY(supportLevel)}
                x2={width - padding.right}
                y2={getY(supportLevel)}
                stroke="#00e676"
                strokeWidth="1.5"
                strokeDasharray="6,4"
              />
              <rect
                x={width - padding.right + 2}
                y={getY(supportLevel) - 10}
                width="72"
                height="18"
                rx="3"
                fill="rgba(0, 230, 118, 0.2)"
                stroke="#00e676"
                strokeWidth="1"
              />
              <text
                x={width - padding.right + 6}
                y={getY(supportLevel) + 3}
                fill="#00e676"
                fontSize="10"
                fontWeight="bold"
                fontFamily="'JetBrains Mono', monospace"
              >
                SUP ${formatPrice(supportLevel)}
              </text>
            </g>
          )}

          {/* Resistance Level Overlay (Rot gestrichelt) */}
          {resistanceLevel > 0 && (
            <g>
              <line
                x1={padding.left}
                y1={getY(resistanceLevel)}
                x2={width - padding.right}
                y2={getY(resistanceLevel)}
                stroke="#ff3860"
                strokeWidth="1.5"
                strokeDasharray="6,4"
              />
              <rect
                x={width - padding.right + 2}
                y={getY(resistanceLevel) - 10}
                width="72"
                height="18"
                rx="3"
                fill="rgba(255, 56, 96, 0.2)"
                stroke="#ff3860"
                strokeWidth="1"
              />
              <text
                x={width - padding.right + 6}
                y={getY(resistanceLevel) + 3}
                fill="#ff3860"
                fontSize="10"
                fontWeight="bold"
                fontFamily="'JetBrains Mono', monospace"
              >
                RES ${formatPrice(resistanceLevel)}
              </text>
            </g>
          )}

          {/* Aktueller Preis Line (Cyan) */}
          {currentPrice > 0 && (
            <g>
              <line
                x1={padding.left}
                y1={getY(currentPrice)}
                x2={width - padding.right}
                y2={getY(currentPrice)}
                stroke="#00e5ff"
                strokeWidth="1"
                strokeOpacity="0.8"
              />
              <rect
                x={width - padding.right + 2}
                y={getY(currentPrice) - 10}
                width="72"
                height="18"
                rx="3"
                fill="#00e5ff"
              />
              <text
                x={width - padding.right + 6}
                y={getY(currentPrice) + 3}
                fill="#05080e"
                fontSize="10"
                fontWeight="bold"
                fontFamily="'JetBrains Mono', monospace"
              >
                ${formatPrice(currentPrice)}
              </text>
            </g>
          )}

          {/* Volume Histogram Bars */}
          {klines.map((k, idx) => {
            const x = padding.left + idx * candleStep + (candleStep - candleWidth) / 2;
            const isBull = k.close >= k.open;
            const volY = getVolY(k.volume);
            const volBarHeight = padding.top + priceChartHeight + 15 + volumeHeight - volY;

            return (
              <rect
                key={`vol-${idx}`}
                x={x}
                y={volY}
                width={candleWidth}
                height={Math.max(1, volBarHeight)}
                fill={isBull ? 'url(#bullVolGrad)' : 'url(#bearVolGrad)'}
                rx="1"
              />
            );
          })}

          {/* Trennlinie für Volumenbereich */}
          <line
            x1={padding.left}
            y1={padding.top + priceChartHeight + 15}
            x2={width - padding.right}
            y2={padding.top + priceChartHeight + 15}
            stroke="rgba(255, 255, 255, 0.08)"
          />
          <text
            x={padding.left + 6}
            y={padding.top + priceChartHeight + 28}
            fill="#5c6a7e"
            fontSize="10"
            fontFamily="'JetBrains Mono', monospace"
          >
            VOLUMEN
          </text>

          {/* Chart Rendering: Kerzen oder Area Line */}
          {chartType === 'line' ? (
            <g>
              <polygon points={areaPoints} fill="url(#areaGlow)" />
              <polyline
                points={linePoints.join(' ')}
                fill="none"
                stroke="#00e5ff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ) : (
            klines.map((k, idx) => {
              const x = padding.left + idx * candleStep + candleStep / 2;
              const isBull = k.close >= k.open;
              const color = isBull ? '#00e676' : '#ff3860';

              const highY = getY(k.high);
              const lowY = getY(k.low);
              const openY = getY(k.open);
              const closeY = getY(k.close);

              const bodyTop = Math.min(openY, closeY);
              const bodyHeight = Math.max(2, Math.abs(closeY - openY));

              return (
                <g key={`candle-${idx}`}>
                  {/* Docht (Wick) */}
                  <line
                    x1={x}
                    y1={highY}
                    x2={x}
                    y2={lowY}
                    stroke={color}
                    strokeWidth="1.2"
                  />
                  {/* Kerzenkörper (Body) */}
                  <rect
                    x={x - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={color}
                    rx="1.5"
                  />
                </g>
              );
            })
          )}

          {/* Interaktiver Crosshair Hover Cursor */}
          {hoverIndex !== null && hoverIndex >= 0 && hoverIndex < klines.length && (
            <g>
              {/* Vertikale Linie */}
              <line
                x1={padding.left + hoverIndex * candleStep + candleStep / 2}
                y1={padding.top}
                x2={padding.left + hoverIndex * candleStep + candleStep / 2}
                y2={padding.top + priceChartHeight + 15 + volumeHeight}
                stroke="rgba(255, 255, 255, 0.4)"
                strokeDasharray="4,4"
              />
              {/* Horizontale Linie auf Höhe der Kerze */}
              <line
                x1={padding.left}
                y1={getY(activeCandle.close)}
                x2={width - padding.right}
                y2={getY(activeCandle.close)}
                stroke="rgba(255, 255, 255, 0.4)"
                strokeDasharray="4,4"
              />
              {/* Kreis auf Close */}
              <circle
                cx={padding.left + hoverIndex * candleStep + candleStep / 2}
                cy={getY(activeCandle.close)}
                r="4.5"
                fill="#ffffff"
                stroke="#00e5ff"
                strokeWidth="2"
              />
            </g>
          )}

          {/* X-Achsen Zeitticks (alle 8-10 Kerzen) */}
          {klines.map((k, idx) => {
            if (idx % 10 === 0 || idx === klines.length - 1) {
              const x = padding.left + idx * candleStep + candleStep / 2;
              const dateObj = new Date(k.time);
              const timeLabel = interval === '1d'
                ? `${dateObj.getDate()}.${dateObj.getMonth() + 1}`
                : dateObj.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

              return (
                <text
                  key={`time-${idx}`}
                  x={x}
                  y={height - 15}
                  textAnchor="middle"
                  fill="#78889b"
                  fontSize="11"
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {timeLabel}
                </text>
              );
            }
            return null;
          })}
        </svg>
      </div>
    </div>
  );
};
