export type TabId = 'dashboard' | 'screener' | 'portfolio' | 'watchlist' | 'stockDetail' | 'reports' | 'settings';

export interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  pctChange: number;
  volume?: string;
  marketCap?: string;
  pe?: number;
  dividend?: number;
  sector?: string;
  trend?: number[];
}

export interface StockRef {
  symbol: string;
  name?: string;
}

export type StockRange = 'intraday' | '5d' | 'daily' | 'weekly' | 'monthly';

export interface StockDetailResponse {
  symbol: string;
  name: string;
  industry?: string | null;
  ownership?: string | null;
  mainBusiness?: string | null;
  latestPrice?: number | null;
  change?: number | null;
  pctChange?: number | null;
  tradeDate?: string | null;
  metrics: {
    pe?: number | null;
    pb?: number | null;
    marketCap?: number | null;
    dividendYield?: number | null;
  };
  chart: {
    range: StockRange;
    points: Array<{
      date: string;
      open: number;
      close: number;
      high: number;
      low: number;
      volume: number;
      pct?: number;
    }>;
  };
}

export interface NewsItem {
  id: string;
  category: string;
  timestamp: string;
  title: string;
  summary: string;
}

export type Rating = 'buy' | 'hold' | 'sell';
export type ReportVerdict = 'win' | 'loss' | 'flat';

export interface ResearchReport {
  id: string;
  title: string;
  ticker: string;
  tickerName: string;
  stocks?: Array<{ symbol: string; name: string | null; verdict: ReportVerdict }>;
  rating: Rating;
  institution: string;
  date: string;
  content: string;
  sourceUrl?: string | null;
  sourceFileName?: string | null;
  klineData: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number }>;
  klineSeries?: Array<{
    symbol: string;
    name: string;
    verdict: ReportVerdict;
    klineData: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number }>;
    startClose: number | null;
    latestClose: number | null;
    changePct: number | null;
  }>;
}
