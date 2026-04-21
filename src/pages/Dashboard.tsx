import React from 'react';
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

// Mock Data
const indexData: StockData[] = [
  { symbol: 'SSEC', name: '上证指数', price: 3042.30, change: 37.28, pctChange: 1.24, trend: [3020, 3015, 3025, 3022, 3035, 3040, 3042] },
  { symbol: 'SZI', name: '深证成指', price: 9401.84, change: 172.68, pctChange: 1.87, trend: [9300, 9320, 9310, 9350, 9380, 9405, 9401] },
  { symbol: 'CHINEXT', name: '创业板指', price: 1805.66, change: -2.71, pctChange: -0.15, trend: [1810, 1808, 1812, 1805, 1802, 1808, 1805] },
];

const watchlistData: StockData[] = [
  { symbol: '700.HK', name: '腾讯控股', price: 273.50, change: 2.5, pctChange: 1.02, sector: '科技', trend: [270, 272, 271, 273, 274, 273, 273.5] },
  { symbol: '9988.HK', name: '阿里巴巴', price: 76.42, change: 1.6, pctChange: 2.15, sector: '科技', trend: [74, 75, 74.5, 75.5, 76, 76.2, 76.42] },
  { symbol: '1211.HK', name: '比亚迪股份', price: 215.22, change: -4.0, pctChange: -1.80, sector: '汽车', trend: [220, 218, 219, 217, 216, 215.5, 215.22] },
];

const newsData: NewsItem[] = [
  { id: '1', category: '宏观', timestamp: '10分钟前', title: '央行释放可能降息信号 应对通胀回落', summary: '央行官员暗示，如果当前的通缩趋势持续到第三季度，可能需要采取更加温和的货币政策...' },
  { id: '2', category: '科技', timestamp: '45分钟前', title: 'AI芯片需求推动半导体股票创历史新高', summary: '行业巨头预测数据中心基础设施的资本支出将达到前所未有的规模，以支持日益增长的AI模型训练需求...' },
  { id: '3', category: '财报', timestamp: '2小时前', title: '零售板块在第一季度财报中表现韧性', summary: '尽管存在更广泛的经济不确定性，消费者支出依然强劲，提振了零售商及其供应链合作伙伴的信心...' },
];

export const Dashboard: React.FC = () => {
  return (
    <div className="space-y-10 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-extrabold font-headline text-primary tracking-tight">市场概览</h1>
          <p className="text-on-surface-variant mt-3 font-medium">全球主要指数实时更新。</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low rounded-full">
          <div className="w-2 h-2 bg-tertiary-container rounded-full animate-pulse" />
          <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">市场状态</span>
          <span className="text-xs font-bold text-tertiary-container ml-1">开盘</span>
        </div>
      </div>

      {/* Index Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {indexData.map((index) => (
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
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={index.trend.map((val, i) => ({ val, i }))}>
                  <Line 
                    type="monotone" 
                    dataKey="val" 
                    stroke={index.pctChange >= 0 ? "#ba1a1a" : "#005111"} 
                    strokeWidth={2} 
                    dot={false} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Watchlist Section */}
        <div className="lg:col-span-8 bg-surface-container-low rounded-[2rem] p-8">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-extrabold font-headline text-primary">我的自选股</h2>
            <button className="text-xs font-bold text-primary px-4 py-2 rounded-lg bg-surface-container-highest hover:bg-surface-dim transition-colors">
              管理列表
            </button>
          </div>

          <div className="space-y-4">
            {watchlistData.map((stock) => (
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
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-primary">宁德时代</span>
                  <span className="text-error font-bold">+4.52%</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-primary">茅台</span>
                  <span className="text-error font-bold">+3.10%</span>
                </div>
              </div>
            </div>

            <div className="p-6 bg-surface-container-highest/50 rounded-2xl">
              <div className="flex items-center gap-2 mb-4 text-tertiary-container">
                <TrendingDown size={18} />
                <span className="font-bold text-xs uppercase tracking-widest">跌幅榜</span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-primary">万科A</span>
                  <span className="text-tertiary-container font-bold">-3.45%</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-primary">中国平安</span>
                  <span className="text-tertiary-container font-bold">-2.10%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* News Feed */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-container-lowest rounded-[2rem] p-8 shadow-[0_8px_32px_rgba(25,28,29,0.02)] h-full">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-extrabold font-headline text-primary">市场资讯</h2>
              <button className="p-2 hover:bg-surface-container-low rounded-full transition-colors">
                 <ExternalLink size={18} className="text-on-surface-variant" />
              </button>
            </div>

            <div className="space-y-10">
              {newsData.map((news) => (
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

            <button className="w-full mt-12 py-3 bg-surface-container-low text-primary text-xs font-extrabold rounded-xl hover:bg-surface-dim transition-all flex items-center justify-center gap-2">
              查看所有简报
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
