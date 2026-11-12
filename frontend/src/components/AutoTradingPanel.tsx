import React, { useState, useEffect } from 'react';
import { TradingAnalysis, BestPick, BotStatus, ServerBotStatus, ActivePosition, TradeJournalEntry } from '../types';
import {
  getTradingBotStatus,
  executeOrder,
  getServerBotStatus,
  toggleServerBot,
  updateServerBotConfig,
  closeServerBotPosition,
  getServerBotJournal
} from '../binanceService';

interface AutoTradingPanelProps {
  selectedSymbol: string;
  coin: string;
  currentPrice: number;
  analysis: TradingAnalysis | null;
  bestPick: BestPick | null;
  serverBot: ServerBotStatus | null;
  onRefreshBot?: () => void;
  formatPrice: (val?: number) => string;
}

export const AutoTradingPanel: React.FC<AutoTradingPanelProps> = ({
  selectedSymbol,
  coin,
  currentPrice,
  analysis,
  serverBot: propServerBot,
  onRefreshBot,
  formatPrice
}) => {
  const [localServerBot, setLocalServerBot] = useState<ServerBotStatus | null>(propServerBot);
  const [journal, setJournal] = useState<TradeJournalEntry[]>([]);
  const [orderSizeUsdt, setOrderSizeUsdt] = useState<number>(50);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isClosingId, setIsClosingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [activeTab, setActiveTab] = useState<'positions' | 'journal' | 'logs' | 'playbook'>('positions');

  const serverBot = propServerBot || localServerBot;

  useEffect(() => {
    if (propServerBot) {
      setLocalServerBot(propServerBot);
      if (propServerBot.config?.order_size_usdt) {
        setOrderSizeUsdt(propServerBot.config.order_size_usdt);
      }
    }
  }, [propServerBot]);

  const refreshAll = async () => {
    try {
      const [srvStatus, jrn] = await Promise.all([
        getServerBotStatus(),
        getServerBotJournal()
      ]);
      if (srvStatus) {
        setLocalServerBot(srvStatus);
        if (srvStatus.config?.order_size_usdt) {
          setOrderSizeUsdt(srvStatus.config.order_size_usdt);
        }
      }
      setJournal(jrn);
      if (onRefreshBot) onRefreshBot();
    } catch (e) {
      // Ignorieren
    }
  };

  useEffect(() => {
    // Initiales Laden des Journals
    getServerBotJournal().then((j) => setJournal(j));
    const interval = setInterval(refreshAll, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleBot = async () => {
    if (!serverBot) return;
    const nextState = !serverBot.bot_active;
    const updated = await toggleServerBot(nextState);
    if (updated) {
      setLocalServerBot(updated);
      setMessage({
        text: nextState
          ? '🤖 24/7 AUTONOMER TRADING-BOT GESTARTET (Läuft dauerhaft im Backend weiter, auch bei geschlossenem Browser!)'
          : '⏸ 24/7 Autonomer Trading-Bot pausiert.',
        type: nextState ? 'success' : 'error'
      });
    }
  };

  const handleOrderSizeChange = async (newSize: number) => {
    setOrderSizeUsdt(newSize);
    await updateServerBotConfig({ order_size_usdt: newSize });
  };

  const handleManualTrade = async (side: 'BUY' | 'SELL') => {
    setIsExecuting(true);
    setMessage(null);

    try {
      const limitPrice = orderType === 'LIMIT'
        ? (analysis?.buy_range_min || currentPrice)
        : undefined;

      const res = await executeOrder({
        symbol: selectedSymbol,
        side,
        order_type: orderType,
        quote_order_qty: side === 'BUY' ? orderSizeUsdt : undefined,
        quantity: side === 'SELL' ? (orderSizeUsdt / currentPrice) : undefined,
        price: limitPrice
      });

      if (res && res.success) {
        const orderData = res.data || {};
        const executedQty = parseFloat(orderData.executedQty || '0');
        const fills = orderData.fills || [];
        const avgPrice = fills.length > 0
          ? fills.reduce((acc: number, f: any) => acc + parseFloat(f.price) * parseFloat(f.qty), 0) / (executedQty || 1)
          : currentPrice;

        setMessage({
          text: `✓ Kauforder erfolgreich ausgeführt! ${coin} über ${orderSizeUsdt} USDT (Kurs: $${formatPrice(avgPrice)})`,
          type: 'success'
        });

        if (res.position) {
          setLocalServerBot((prev) => {
            if (!prev) return prev;
            const updated = [res.position, ...(prev.open_positions || []).filter((p) => p.symbol !== res.position.symbol)];
            return {
              ...prev,
              open_positions: updated,
              open_positions_count: updated.length
            };
          });
        }
        refreshAll();
      } else {
        setMessage({
          text: `Fehler: ${res.error || 'Order wurde von Binance abgelehnt'}`,
          type: 'error'
        });
      }
    } catch (err: any) {
      setMessage({
        text: `Netzwerkfehler: ${err.message}`,
        type: 'error'
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleClosePosition = async (pos: ActivePosition) => {
    setIsClosingId(pos.id);
    try {
      const res = await closeServerBotPosition(pos.id);
      if (res && res.success) {
        const closedPnl = res.journal_entry?.pnl_usdt ?? pos.unrealized_pnl_usdt ?? 0;
        setMessage({
          text: `✓ Position ${pos.coin} erfolgreich zum Marktpreis geschlossen! Realisierter PnL: ${closedPnl >= 0 ? '+' : ''}${closedPnl.toFixed(2)} USDT`,
          type: 'success'
        });
        // Sofort optimistisch aus lokalem State entfernen fuer verzögerungsfreies UI
        setLocalServerBot((prev) => {
          if (!prev) return prev;
          const remaining = (prev.open_positions || []).filter((p) => p.id !== pos.id);
          return {
            ...prev,
            open_positions: remaining,
            open_positions_count: remaining.length
          };
        });
        refreshAll();
      } else {
        setMessage({
          text: `Fehler beim Schliessen: ${res?.error || 'Unbekannt'}`,
          type: 'error'
        });
      }
    } catch (err: any) {
      setMessage({
        text: `Fehler: ${err.message}`,
        type: 'error'
      });
    } finally {
      setIsClosingId(null);
    }
  };

  const openPositions = serverBot?.open_positions || [];
  const totalUnrealizedPnl = openPositions.reduce((sum, p) => sum + (p.unrealized_pnl_usdt || 0), 0);
  const botIsRunning = serverBot?.bot_active && serverBot?.worker_running;

  return (
    <div className="trading-execution-card">
      {/* 1. Header & Live 24/7 Status */}
      <div className="trading-exec-header">
        <div className="exec-title-group">
          <span className="exec-icon">🤖</span>
          <div>
            <div className="exec-title">24/7 AUTONOMER TRADING-BOT • BINANCE TESTNET</div>
            <div className="exec-subtitle">
              Läuft als permanenter Python-Hintergrund-Dienst (Handelt, setzt Stop-Loss & nimmt Gewinne mit – auch bei geschlossenem Browser)
            </div>
          </div>
        </div>

        {/* Live Balance & Autopilot Toggle */}
        <div className="exec-status-group">
          {serverBot ? (
            <div className="balance-pill">
              <span className="live-dot-green"></span>
              <span className="balance-label">Testnet USDT:</span>
              <strong className="balance-val">
                ${(serverBot.usdt_free ?? 9985.05).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
            </div>
          ) : (
            <div className="balance-pill offline">
              <span className="live-dot-yellow"></span>
              <span>Backend verbinden...</span>
            </div>
          )}

          {/* 24/7 Bot Schalter */}
          <button
            onClick={handleToggleBot}
            className={`autopilot-toggle-btn ${botIsRunning ? 'active-autopilot' : ''}`}
            title="Schaltet den 24/7 Hintergrund-Trading-Bot an oder aus"
          >
            {botIsRunning ? '⚡ 24/7 BOT: AKTIV' : '⏸ 24/7 BOT: PAUSIERT'}
          </button>
        </div>
      </div>

      {/* 2. Banner wenn 24/7 Bot aktiv */}
      {botIsRunning && (
        <div className="autopilot-active-banner">
          <span className="radar-icon-pulse">🟢</span>
          <span>
            <strong>24/7 AUTOPILOT & SMART-DCA AKTIV:</strong> Scannt alle 12s nach Kaufchancen. <strong>Neu:</strong> Bei gesunden Dips am Support kauft der Bot selbstständig bis zu 2x nach, um den Einstiegskurs zu verbilligen. Stop-Loss & Take-Profit werden rund um die Uhr überwacht.
          </span>
        </div>
      )}

      {/* 3. Feedback Notification Message */}
      {message && (
        <div className={`trade-toast-msg ${message.type}`}>
          {message.type === 'success' ? '✓ ' : '⚠️ '}
          {message.text}
        </div>
      )}

      {/* 4. Performance & Statistik KPIs */}
      <div className="bot-stats-strip">
        <div className="bot-kpi-item">
          <span className="kpi-label">Aktive Positionen</span>
          <span className="kpi-val">{openPositions.length} / {serverBot?.config?.max_open_positions || 5}</span>
        </div>
        <div className="bot-kpi-item">
          <span className="kpi-label">Laufender PnL (Floating)</span>
          <span className={`kpi-val ${totalUnrealizedPnl >= 0 ? 'text-green' : 'text-red'}`}>
            {totalUnrealizedPnl >= 0 ? '+' : ''}${totalUnrealizedPnl.toFixed(2)} USDT
          </span>
        </div>
        <div className="bot-kpi-item">
          <span className="kpi-label">Realisierter Gesamt-Gewinn</span>
          <span className={`kpi-val ${(serverBot?.total_pnl_usdt || 0) >= 0 ? 'text-green' : 'text-red'}`}>
            {(serverBot?.total_pnl_usdt || 0) >= 0 ? '+' : ''}${serverBot?.total_pnl_usdt || '0.00'} USDT
          </span>
        </div>
        <div className="bot-kpi-item">
          <span className="kpi-label">Win-Rate</span>
          <span className="kpi-val text-cyan">{serverBot?.win_rate_pct || 0}%</span>
        </div>
        <div className="bot-kpi-item">
          <span className="kpi-label">Abgeschlossene Trades</span>
          <span className="kpi-val">{serverBot?.total_trades || 0}</span>
        </div>
      </div>

      {/* 5. Trading Steuerung (Positionsgröße & 1-Klick Ausführung) */}
      <div className="trading-controls-grid">
        {/* Positionsgröße */}
        <div className="control-card">
          <div className="control-label">Positionsgröße pro Trade:</div>
          <div className="amount-chips">
            {[25, 50, 100, 250].map((amt) => (
              <button
                key={amt}
                onClick={() => handleOrderSizeChange(amt)}
                className={`amt-chip ${orderSizeUsdt === amt ? 'selected' : ''}`}
              >
                ${amt} USDT
              </button>
            ))}
          </div>
          <div className="control-sub">
            Gilt sowohl für automatische 24/7 Trades als auch für manuelle Klicks.
          </div>
        </div>

        {/* 2. Order-Typ */}
        <div className="control-card">
          <div className="control-label">Order-Typ (Manuell):</div>
          <div className="type-toggle-group">
            <button
              onClick={() => setOrderType('MARKET')}
              className={`type-btn ${orderType === 'MARKET' ? 'selected' : ''}`}
            >
              ⚡ Sofort (Market)
            </button>
            <button
              onClick={() => setOrderType('LIMIT')}
              className={`type-btn ${orderType === 'LIMIT' ? 'selected' : ''}`}
            >
              🎯 Kauf-Range (Limit)
            </button>
          </div>
          <div className="control-sub">
            {orderType === 'MARKET'
              ? 'Kauft sofort zum aktuellen Marktpreis.'
              : `Platziert Limit in der Kauf-Range ($${analysis?.buy_range_min || currentPrice}).`}
          </div>
        </div>

        {/* 3. Hebel & Leverage Multiplier */}
        <div className="control-card">
          <div className="control-label">Hebel & Multiplier (Futures):</div>
          <div className="amount-chips">
            {['AI', 10, 25, 50, 100].map((lev) => {
              const isAi = lev === 'AI';
              const currentMode = serverBot?.config?.leverage_mode || 'AI_DYNAMIC';
              const currentVal = serverBot?.config?.default_leverage || 20;
              const isSelected = isAi ? currentMode === 'AI_DYNAMIC' : (currentMode === 'MANUAL' && currentVal === lev);
              return (
                <button
                  key={String(lev)}
                  onClick={async () => {
                    if (isAi) {
                      await updateServerBotConfig({ leverage_mode: 'AI_DYNAMIC' });
                    } else {
                      await updateServerBotConfig({ leverage_mode: 'MANUAL', default_leverage: lev });
                    }
                    refreshAll();
                  }}
                  className={`amt-chip ${isSelected ? 'selected' : ''}`}
                >
                  {isAi ? '🤖 KI-Auto' : `${lev}x`}
                </button>
              );
            })}
          </div>
          <div className="control-sub">
            {(serverBot?.config?.leverage_mode || 'AI_DYNAMIC') === 'AI_DYNAMIC'
              ? 'KI wählt Hebel (5x bis 100x) autonom anhand von Setup-Score & Stop-Loss-Distanz.'
              : `Fester Hebel: ${serverBot?.config?.default_leverage || 20}x aktiv.`}
          </div>
        </div>

        {/* 1-Klick Action Buttons */}
        <div className="control-card action-card">
          <div className="control-label">1-Klick Schnell-Order für {coin}:</div>
          <div className="action-buttons-row">
            <button
              onClick={() => handleManualTrade('BUY')}
              disabled={isExecuting || !serverBot}
              className="exec-buy-btn"
            >
              {isExecuting ? '⏳ Sende Order...' : `🟢 ${coin} KAUFEN ($${orderSizeUsdt})`}
            </button>

            <button
              onClick={() => handleManualTrade('SELL')}
              disabled={isExecuting || !serverBot}
              className="exec-sell-btn"
            >
              🔴 {coin} VERKAUFEN
            </button>
          </div>
          <div className="control-sub text-center">
            Aktueller Kurs: ${formatPrice(currentPrice)} • SL: ${formatPrice(analysis?.trade_setup.stop_loss)}
          </div>
        </div>
      </div>

      {/* 6. Tabs: Aktive Positionen | Trade-Journal | Bot-Logs */}
      <div className="bot-tabs-bar">
        <button
          onClick={() => setActiveTab('positions')}
          className={`bot-tab-btn ${activeTab === 'positions' ? 'active' : ''}`}
        >
          💼 Offene Positionen ({openPositions.length})
        </button>
        <button
          onClick={() => setActiveTab('journal')}
          className={`bot-tab-btn ${activeTab === 'journal' ? 'active' : ''}`}
        >
          📜 Trade-Journal ({journal.length})
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`bot-tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
        >
          🖥️ Bot-Aktivitätslog
        </button>
        <button
          onClick={() => setActiveTab('playbook')}
          className={`bot-tab-btn ${activeTab === 'playbook' ? 'active' : ''}`}
        >
          📖 KI-Marktanleitung (Kauf & Dynamischer Verkauf)
        </button>
      </div>

      {/* Tab 1: Aktive offene Positionen */}
      {activeTab === 'positions' && (
        <div className="tab-content-area">
          {openPositions.length === 0 ? (
            <div className="empty-positions-box">
              <span>Keine offenen Positionen. Der 24/7 Bot scannt den Markt nach optimalen Kauf-Gelegenheiten.</span>
            </div>
          ) : (
            <div className="positions-grid">
              {openPositions.map((pos) => {
                const pnl = pos.unrealized_pnl_usdt || 0;
                const roi = pos.unrealized_roi_pct || 0;
                return (
                  <div key={pos.id} className={`position-card ${pnl >= 0 ? 'pos-green' : 'pos-red'}`}>
                    <div className="pos-card-header">
                      <div>
                        <span className="pos-coin">{pos.coin}</span>
                        <span className="pos-side">LONG</span>
                        <span className="pos-lev-badge">
                          ⚡ {pos.leverage || 1}x HEBEL
                        </span>
                        {pos.dca_count && pos.dca_count > 0 ? (
                          <span className="pos-dca-badge" title="Mischkurs durch KI-Dip-Nachkauf vergünstigt">
                            🔄 DCA {pos.dca_count}/2
                          </span>
                        ) : null}
                      </div>
                      <div className={`pos-pnl-badge ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({roi >= 0 ? '+' : ''}{roi.toFixed(2)}%)
                      </div>
                    </div>

                    <div className="pos-details-grid">
                      <div>
                        <span className="pos-dim">Kaufkurs:</span>
                        <strong>${formatPrice(pos.entry_price)}</strong>
                      </div>
                      <div>
                        <span className="pos-dim">Aktueller Kurs:</span>
                        <strong>${formatPrice(pos.current_price || pos.entry_price)}</strong>
                      </div>
                      <div>
                        <span className="pos-dim">Margin (Einsatz):</span>
                        <strong>${(pos.margin_spent || pos.quote_spent || 0).toFixed(2)} USDT</strong>
                      </div>
                      <div>
                        <span className="pos-dim">Kaufkraft ({pos.leverage || 1}x):</span>
                        <strong className="text-cyan">${(pos.notional_value || ((pos.margin_spent || pos.quote_spent || 0) * (pos.leverage || 1))).toFixed(2)} USDT</strong>
                      </div>
                      <div>
                        <span className="pos-dim">Stop-Loss:</span>
                        <strong className="text-red">${formatPrice(pos.stop_loss)}</strong>
                      </div>
                      <div>
                        <span className="pos-dim">Take-Profit 2:</span>
                        <strong className="text-green">${formatPrice(pos.take_profit_2)}</strong>
                      </div>
                    </div>

                    <div className="pos-footer">
                      <span className="pos-reason-text">{pos.reason}</span>
                      <button
                        onClick={() => handleClosePosition(pos)}
                        disabled={isClosingId === pos.id}
                        className="close-pos-btn"
                      >
                        {isClosingId === pos.id ? 'Schließe...' : '⚡ Jetzt Schließen'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Trade-Journal (Abgeschlossene Trades) */}
      {activeTab === 'journal' && (
        <div className="tab-content-area">
          {journal.length === 0 ? (
            <div className="empty-positions-box">
              <span>Bisher noch keine abgeschlossenen Trades im Journal.</span>
            </div>
          ) : (
            <div className="history-table-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Geschlossen</th>
                    <th>Coin</th>
                    <th>Kaufkurs</th>
                    <th>Verkaufskurs</th>
                    <th>Einsatz</th>
                    <th>Gewinn / Verlust (PnL)</th>
                    <th>Grund / Exit</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((t) => (
                    <tr key={t.id} className="history-row">
                      <td>{new Date(t.closed_at * 1000).toLocaleTimeString('de-DE')}</td>
                      <td><strong>{t.coin}</strong></td>
                      <td>${formatPrice(t.entry_price)}</td>
                      <td>${formatPrice(t.exit_price)}</td>
                      <td>${(t.quote_spent ?? t.margin_spent ?? 0).toFixed(2)} USDT</td>
                      <td>
                        <strong className={t.pnl_usdt >= 0 ? 'text-green' : 'text-red'}>
                          {t.pnl_usdt >= 0 ? '+' : ''}${t.pnl_usdt.toFixed(2)} ({t.roi_pct >= 0 ? '+' : ''}{t.roi_pct}%)
                        </strong>
                      </td>
                      <td>
                        <span className="journal-exit-tag">{t.exit_reason}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Bot Aktivitätslogs */}
      {activeTab === 'logs' && (
        <div className="tab-content-area">
          <div className="bot-logs-console">
            {(serverBot?.recent_logs || []).map((log, i) => (
              <div key={i} className={`log-line ${log.level.toLowerCase()}`}>
                <span className="log-time">[{log.time_str}]</span>
                <span className={`log-level-tag ${log.level}`}>{log.level}</span>
                <span className="log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: KI-Marktanleitung (Kauf- & Verkaufs-Regeln) */}
      {activeTab === 'playbook' && (
        <div className="tab-content-area">
          <div className="playbook-container">
            <div className="playbook-column buy-column">
              <div className="playbook-col-header">
                <span className="col-icon">🟢</span>
                <div>
                  <h4>100% KAUF-ANLEITUNG (A+ SETUP CHECKLISTE)</h4>
                  <p>Der Bot kauft ab sofort nur noch, wenn ALLE 5 Kriterien erfüllt sind:</p>
                </div>
              </div>
              <div className="playbook-rules-list">
                <div className="playbook-rule-item">
                  <span className="rule-badge">1</span>
                  <div>
                    <strong>Spitzen-Score ≥ 88 Punkte:</strong>
                    <span>Nur Marktchancen mit höchster KI-Konfidenz und überlegener Trefferquote.</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge">2</span>
                  <div>
                    <strong>Kern-Kaufzone (≤ 28 % der Range):</strong>
                    <span>Kauf ausschließlich im untersten Viertel direkt am Support – niemals teuer in der Mitte!</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge">3</span>
                  <div>
                    <strong>RSI 15m Abkühlung (≤ 42):</strong>
                    <span>Der Markt muss einen spürbaren Dip vollzogen haben und reif für den Rebound sein.</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge">4</span>
                  <div>
                    <strong>Support-Stabilität:</strong>
                    <span>Der Kurs muss den lokalen Boden verteidigen (kein freier Fall / kein fallendes Messer).</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge">5</span>
                  <div>
                    <strong>Chance-Risiko-Verhältnis ≥ 2,5 : 1:</strong>
                    <span>Das Gewinnpotenzial muss mindestens 2,5x größer sein als das rechnerische Verlustrisiko.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="playbook-column sell-column">
              <div className="playbook-col-header">
                <span className="col-icon">🔴</span>
                <div>
                  <h4>DYNAMISCHE VERKAUFS-ANLEITUNG (GEWINNMITNAHME)</h4>
                  <p>Der Bot wartet nicht stur auf ein starres Ziel, sondern agiert flexibel am Markt:</p>
                </div>
              </div>
              <div className="playbook-rules-list">
                <div className="playbook-rule-item">
                  <span className="rule-badge gold">⚡</span>
                  <div>
                    <strong>Dynamischer Trailing-Profit-Stop (NEU):</strong>
                    <span>Sobald ein Trade im Plus (&ge; +1,5 %) ist, sichert der Bot den Höchststand ab. Fällt der Kurs vom Peak um 0,6 % zurück, wird sofort verkauft – Gewinne werden nie wieder abgegeben!</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge gold">🔥</span>
                  <div>
                    <strong>RSI-Überhitzungs-Exit (NEU):</strong>
                    <span>Schießt der RSI 15m über 68 und die Position ist im Gewinn (&ge; +1,0 %), verkauft der Bot direkt am Top vor dem Rücksetzer.</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge green">🎯</span>
                  <div>
                    <strong>Take-Profit 2 (Hauptziel):</strong>
                    <span>Erreicht der Kurs das Hauptziel der Range (+3 % bis +6 %), wird die Position mit maximalem Gewinn komplett glattgestellt.</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge cyan">🛡️</span>
                  <div>
                    <strong>Breakeven-Schutz auf TP1:</strong>
                    <span>Ab Erreichen des ersten Zwischenziels (+1,8 %) wird der Stop auf Einstand gezogen (100 % risikofrei).</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge red">🛑</span>
                  <div>
                    <strong>Harter Stop-Loss:</strong>
                    <span>Unterhalb des Supports greift die Notbremse, um das Gesamtkapital strikt zu schützen.</span>
                  </div>
                </div>
                <div className="playbook-rule-item">
                  <span className="rule-badge purple">🖐️</span>
                  <div>
                    <strong>1-Klick Manuell Schließen:</strong>
                    <span>Der Fehler 400 (Insufficient Balance) ist behoben – du kannst jede Position jederzeit mit 1 Klick sofort beenden.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
