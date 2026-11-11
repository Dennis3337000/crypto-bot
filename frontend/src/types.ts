export interface CoinItem {
  symbol: string;
  coin: string;
  name: string;
  category: string;
}

export interface Stat15m {
  interval_label: string;
  change_pct: number;
  high: number;
  low: number;
  volume_base: number;
  open: number;
}

export interface Stat1h {
  interval_label: string;
  change_pct: number;
  high: number;
  low: number;
  volume_base: number;
  open: number;
}

export interface Stat24h {
  interval_label: string;
  change_pct: number;
  change_usd: number;
  high: number;
  low: number;
  volume_base: number;
  volume_quote_usd: number;
}

export interface Stat1m {
  interval_label: string;
  change_pct: number;
  high: number;
  low: number;
}

export interface Stat1y {
  interval_label: string;
  change_pct: number;
  high: number;
  low: number;
}

export interface StatAllTime {
  interval_label: string;
  change_pct: number;
  ath: number;
  atl: number;
  distance_to_ath_pct: number;
  history_months: number;
}

export interface MarketData {
  symbol: string;
  current_price: number;
  stats_15m: Stat15m;
  stats_1h: Stat1h;
  stats_24h: Stat24h;
  stats_1m: Stat1m;
  stats_1y: Stat1y;
  stats_all_time: StatAllTime;
}

export interface TradeSetup {
  setup_name: string;
  entry_zone: string;
  buy_range_min?: number;
  buy_range_max?: number;
  buy_range_label?: string;
  range_position_pct?: number;
  range_status?: string;
  distance_to_buy_pct?: number;
  stop_loss: number;
  stop_loss_pct: number;
  take_profit_1: number;
  take_profit_1_pct: number;
  take_profit_2: number;
  take_profit_2_pct: number;
  crv: string;
  crv_tp1: string;
  tactical_rationale: string;
}

export interface TradingAnalysis {
  symbol: string;
  current_price: number;
  signal: 'BUY' | 'SELL' | 'WAIT';
  signal_label: string;
  confidence: string;
  rsi_15m: number;
  rsi_1h: number;
  support_level: number;
  resistance_level: number;
  range_position_pct?: number;
  range_status?: string;
  buy_range_min?: number;
  buy_range_max?: number;
  buy_range_label?: string;
  distance_to_buy_pct?: number;
  trade_setup: TradeSetup;
}

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  close_time: number;
}

export interface BestPick {
  symbol: string;
  coin: string;
  name: string;
  category: string;
  current_price: number;
  change_24h_pct: number;
  score: number;
  signal: 'BUY' | 'SELL' | 'WAIT';
  signal_label: string;
  rsi_15m: number;
  entry_zone: string;
  buy_range_min?: number;
  buy_range_max?: number;
  buy_range_label?: string;
  range_position_pct?: number;
  range_status?: string;
  distance_to_buy_pct?: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  crv: string;
  reasons: string[];
  tactical_rationale: string;
}

export interface BestPickResponse {
  best_pick: BestPick | null;
  ranking: BestPick[];
  generated_at: string;
}

export interface TradeExecution {
  order_id: number | string;
  symbol: string;
  coin: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quote_amount: number;
  executed_qty: number;
  executed_price: number;
  timestamp: number;
  status: string;
  reason?: string;
  is_autopilot?: boolean;
}

export interface BotStatus {
  configured: boolean;
  connected: boolean;
  usdt_free: number;
  balances: Array<{ asset: string; free: number; locked: number; total: number }>;
  message?: string;
  error?: string;
}

export interface ActivePosition {
  id: string;
  symbol: string;
  coin: string;
  side: 'LONG';
  leverage?: number;
  margin_spent?: number;
  notional_value?: number;
  liquidation_price?: number;
  entry_price: number;
  current_price: number;
  qty: number;
  quote_spent: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  entered_at: number;
  tp1_reached: boolean;
  dca_count?: number;
  last_dca_time?: number;
  unrealized_pnl_usdt?: number;
  unrealized_roi_pct?: number;
  peak_price?: number;
  score: number;
  reason: string;
}

export interface TradeJournalEntry {
  id: string;
  symbol: string;
  coin: string;
  side: 'LONG';
  leverage?: number;
  margin_spent?: number;
  entry_price: number;
  exit_price: number;
  qty: number;
  quote_spent: number;
  quote_received: number;
  pnl_usdt: number;
  roi_pct: number;
  entered_at: number;
  closed_at: number;
  exit_reason: string;
}

export interface ServerBotStatus {
  bot_active: boolean;
  worker_running: boolean;
  usdt_free?: number;
  positions_value_usdt?: number;
  total_capital_usdt?: number;
  initial_capital_usdt?: number;
  capital_growth_pct?: number;
  config: {
    enabled: boolean;
    order_size_usdt: number;
    min_score: number;
    max_open_positions: number;
    cooldown_minutes: number;
    scan_interval_seconds: number;
    auto_stop_loss: boolean;
    auto_take_profit: boolean;
    break_even_on_tp1: boolean;
    enable_smart_dca?: boolean;
    max_dca_levels?: number;
    dca_min_dip_pct?: number;
    leverage_mode?: 'AI_DYNAMIC' | 'MANUAL';
    max_leverage?: number;
    default_leverage?: number;
  };
  open_positions_count: number;
  open_positions: ActivePosition[];
  total_trades: number;
  win_rate_pct: number;
  total_pnl_usdt: number;
  last_scan_time: number;
  recent_logs: Array<{
    timestamp: number;
    time_str: string;
    level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
    message: string;
    details?: any;
  }>;
}
