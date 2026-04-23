import React, { useEffect, useState } from 'react';
import { 
  LineChart, 
  Line, 
  ResponsiveContainer, 
  XAxis, 
  YAxis, 
  Tooltip as ReTooltip 
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  ExternalLink,
  ChevronRight,
  Plus
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { StockData, NewsItem } from '@/src/types';

interface MarketStatus {
  status: string;
  label: string;
}

interface WatchlistStock {
  symbol: string;
  name: string;
  price: number;
  pct: number;
  sector?: string;
  trend?: number[];
}

interface WatchlistGroup {
  stocks: WatchlistStock[];
}

interface MoverItem {
  symbol: string;
  name: string;
  pctChange: number;
}

const EMPTY_MARKET_STATUS: MarketStatus = {
  status: 'unknown',
  label: '未知',
};

const formatSignedPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export const Dashboard: React.FC = () => {
  const [indices, setIndices] = useState<StockData[]>([]);
  const [watchlist, setWatchlist] = useState<StockData[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [gainers, setGainers] = useState<MoverItem[]>([]);
  const [losers, setLosers] = useState<MoverItem[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(EMPTY_MARKET_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadDashboard = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const [
          statusResponse,
          indicesResponse,
          watchlistResponse,
          newsResponse,
          gainersResponse,
          losersResponse,
        ] = await Promise.all([
          fetch('/api/v1/market/status'),
          fetch('/api/v1/market/indices'),
          fetch('/api/v1/watchlists?group_by=flat'),
          fetch('/api/v1/news?limit=3'),
          fetch('/api/v1/market/movers?direction=gainers&limit=2'),
          fetch('/api/v1/market/movers?direction=losers&limit=2'),
        ]);

        const responses = [
          statusResponse,
          indicesResponse,
          watchlistResponse,
          newsResponse,
          gainersResponse,
          losersResponse,
        ];
        const failedResponse = responses.find((response) => !response.ok);
        if (failedResponse) {
          throw new Error(`HTTP ${failedResponse.status}`);
        }

        const [statusPayload, indicesPayload, watchlistPayload, newsPayload, gainersPayload, losersPayload] =
          await Promise.all([
            statusResponse.json() as Promise<MarketStatus>,
            indicesResponse.json() as Promise<{ items?: StockData[] }>,
            watchlistResponse.json() as Promise<{ groups?: WatchlistGroup[] }>,
            newsResponse.json() as Promise<{ items?: NewsItem[] }>,
            gainersResponse.json() as Promise<{ items?: MoverItem[] }>,
            losersResponse.json() as Promise<{ items?: MoverItem[] }>,
          ]);

        if (!isMounted) return;

        const firstWatchlistGroup = watchlistPayload.groups?.[0];
        setMarketStatus(statusPayload);
        setIndices(indicesPayload.items ?? []);
        setWatchlist((firstWatchlistGroup?.stocks ?? []).slice(0, 5).map((stock) => ({
          symbol: stock.symbol,
          name: stock.name,
          price: stock.price,
          change: 0,
          pctChange: stock.pct,
          sector: stock.sector,
          trend: stock.trend,
        })));
        setNews(newsPayload.items ?? []);
        setGainers(gainersPayload.items ?? []);
        setLosers(losersPayload.items ?? []);
      } catch (error) {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : '未知错误');
        setMarketStatus(EMPTY_MARKET_STATUS);
        setIndices([]);
        setWatchlist([]);
        setNews([]);
        setGainers([]);
        setLosers([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="space-y-10 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-extrabold font-headline text-primary tracking-tight">市场概览</h1>
          <p className="text-on-surface-variant mt-3 font-medium">A 股主要指数实时更新。</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low rounded-full">
          <div className="w-2 h-2 bg-tertiary-container rounded-full animate-pulse" />
          <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">市场状态</span>
          <span className="text-xs font-bold text-tertiary-container ml-1">{marketStatus.label}</span>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-2xl border border-tertiary-container/20 bg-tertiary-container/10 px-6 py-4 text-sm font-bold text-tertiary-container">
          仪表盘数据加载失败: {errorMessage}
        </div>
      )}

      {/* Index Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isLoading && indices.length === 0 && (
          <div className="md:col-span-3 bg-surface-container-lowest rounded-2xl p-8 text-center text-sm font-bold text-on-surface-variant">
            正在加载后端市场数据...
          </div>
        )}
        {!isLoading && !errorMessage && indices.length === 0 && (
          <div className="md:col-span-3 bg-surface-container-lowest rounded-2xl p-8 text-center text-sm font-bold text-on-surface-variant">
            暂无指数数据。
          </div>
        )}
        {indices.map((index) => (
          <div key={index.symbol} className="bg-surface-container-lowest rounded-2xl p-6 shadow-[0_4px_24px_rgba(25,28,29,0.02)] flex flex-col justify-between h-48 group hover:shadow-lg transition-all duration-500">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-headline font-bold text-lg text-primary">{index.name}</h3>
                <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">{index.symbol}</p>
              </div>
              <div className={cn(
                "px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1",
                // Chinese market: UP=Red, DOWN=Green
                index.pctChange >= 0 ? "bg-error-container/10 text-error" : "bg-tertiary-container/10 text-tertiary-container"
              )}>
                {index.pctChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {index.pctChange >= 0 ? '+' : ''}{index.pctChange}%
              </div>
            </div>

            <div className="mt-4">
              <div className="text-3xl font-bold font-headline tabular-nums">
                {index.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className={cn(
                "text-xs font-medium mt-1",
                index.change >= 0 ? "text-error" : "text-tertiary-container"
              )}>
                {index.change >= 0 ? '+' : ''}{index.change} 今日
              </div>
            </div>

            <div className="h-12 mt-4 opacity-50 group-hover:opacity-100 transition-opacity">
              {(index.trend?.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={index.trend?.map((val, i) => ({ val, i }))}>
                    <Line
                      type="monotone"
                      dataKey="val"
                      stroke={index.pctChange >= 0 ? "#ba1a1a" : "#005111"}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center text-[10px] font-bold text-on-surface-variant/60">暂无趋势</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Watchlist Section */}
        <div className="lg:col-span-8 bg-surface-container-low rounded-[2rem] p-8">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-extrabold font-headline text-primary">我的自选股</h2>
            <button type="button" className="text-xs font-bold text-primary px-4 py-2 rounded-lg bg-surface-container-highest hover:bg-surface-dim transition-colors">
              管理列表
            </button>
          </div>

          <div className="space-y-4">
            {isLoading && watchlist.length === 0 && (
              <div className="bg-surface-container-lowest rounded-xl p-6 text-center text-sm font-bold text-on-surface-variant">
                正在加载自选股...
              </div>
            )}
            {!isLoading && !errorMessage && watchlist.length === 0 && (
              <div className="bg-surface-container-lowest rounded-xl p-6 text-center text-sm font-bold text-on-surface-variant">
                暂无自选股数据，请先同步选股器数据或添加自选股。
              </div>
            )}
            {watchlist.map((stock) => (
              <div key={stock.symbol} className="bg-surface-container-lowest rounded-xl p-4 flex items-center justify-between hover:scale-[1.01] transition-transform shadow-sm">
                <div className="flex items-center gap-4 w-1/3">
                  <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-tertiary-fixed font-bold text-[10px]">
                    {stock.symbol.split('.')[0]}
                  </div>
                  <div>
                    <h4 className="font-bold text-primary">{stock.name}</h4>
                    <p className="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">{stock.sector}</p>
                  </div>
                </div>

                <div className="w-1/4 h-8 flex items-center">
                  {(stock.trend?.length ?? 0) > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stock.trend?.map((val, i) => ({ val, i }))}>
                        <Line
                          type="monotone"
                          dataKey="val"
                          stroke={stock.pctChange >= 0 ? "#ba1a1a" : "#005111"}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <span className="text-[10px] font-bold text-on-surface-variant/60">暂无趋势</span>
                  )}
                </div>

                <div className="text-right">
                  <div className="font-bold tabular-nums text-lg">{stock.price.toFixed(2)}</div>
                  <div className={cn(
                    "text-xs font-bold",
                    stock.pctChange >= 0 ? "text-error" : "text-tertiary-container"
                  )}>
                    {stock.pctChange >= 0 ? '+' : ''}{stock.pctChange}%
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6">
            <div className="p-6 bg-surface-container-highest/50 rounded-2xl">
              <div className="flex items-center gap-2 mb-4 text-error">
                <TrendingUp size={18} />
                <span className="font-bold text-xs uppercase tracking-widest">涨幅榜</span>
              </div>
              <div className="space-y-3">
                {gainers.length === 0 && (
                  <p className="text-xs font-bold text-on-surface-variant">暂无涨幅数据</p>
                )}
                {gainers.map((item) => (
                  <div key={item.symbol} className="flex justify-between items-center text-sm">
                    <span className="font-bold text-primary">{item.name}</span>
                    <span className="text-error font-bold">{formatSignedPercent(item.pctChange)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 bg-surface-container-highest/50 rounded-2xl">
              <div className="flex items-center gap-2 mb-4 text-tertiary-container">
                <TrendingDown size={18} />
                <span className="font-bold text-xs uppercase tracking-widest">跌幅榜</span>
              </div>
              <div className="space-y-3">
                {losers.length === 0 && (
                  <p className="text-xs font-bold text-on-surface-variant">暂无跌幅数据</p>
                )}
                {losers.map((item) => (
                  <div key={item.symbol} className="flex justify-between items-center text-sm">
                    <span className="font-bold text-primary">{item.name}</span>
                    <span className="text-tertiary-container font-bold">{formatSignedPercent(item.pctChange)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* News Feed */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-container-lowest rounded-[2rem] p-8 shadow-[0_8px_32px_rgba(25,28,29,0.02)] h-full">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-extrabold font-headline text-primary">市场资讯</h2>
              <button type="button" aria-label="打开市场资讯" className="p-2 hover:bg-surface-container-low rounded-full transition-colors">
                 <ExternalLink size={18} className="text-on-surface-variant" />
              </button>
            </div>

            <div className="space-y-10">
              {isLoading && news.length === 0 && (
                <div className="text-sm font-bold text-on-surface-variant">正在加载市场资讯...</div>
              )}
              {!isLoading && !errorMessage && news.length === 0 && (
                <div className="text-sm font-bold text-on-surface-variant">暂无市场资讯。</div>
              )}
              {news.map((news) => (
                <div key={news.id} className="group cursor-pointer">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-2 py-0.5 bg-primary rounded text-[9px] font-bold text-surface uppercase tracking-widest">
                      {news.category}
                    </span>
                    <span className="text-[10px] text-on-surface-variant font-medium">
                      {news.timestamp}
                    </span>
                  </div>
                  <h4 className="font-headline font-bold text-primary group-hover:text-primary-container leading-snug transition-colors">
                    {news.title}
                  </h4>
                  <p className="text-xs text-on-surface-variant mt-2 line-clamp-2 leading-relaxed">
                    {news.summary}
                  </p>
                </div>
              ))}
            </div>

            <button type="button" className="w-full mt-12 py-3 bg-surface-container-low text-primary text-xs font-extrabold rounded-xl hover:bg-surface-dim transition-all flex items-center justify-center gap-2">
              查看所有简报
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
