export type TabId = 'dashboard' | 'screener' | 'portfolio' | 'watchlist' | 'reports' | 'settings';

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

export interface NewsItem {
  id: string;
  category: string;
  timestamp: string;
  title: string;
  summary: string;
}

export type Rating = 'buy' | 'hold' | 'sell';

export interface ResearchReport {
  id: string;
  title: string;
  ticker: string;
  tickerName: string;
  rating: Rating;
  institution: string;
  date: string;
  content: string;
  klineData: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number }>;
}
