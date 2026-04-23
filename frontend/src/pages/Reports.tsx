import React, { useState } from 'react';
import { 
  FileText, 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  ChevronRight, 
  Search,
  Filter,
  Calendar,
  Building
} from 'lucide-react';
import { 
  ComposedChart, 
  Line, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { cn } from '@/src/lib/utils';
import { ResearchReport, Rating } from '@/src/types';

const mockReports: ResearchReport[] = [
  {
    id: '1',
    title: '宁德时代：全球锂电龙头地位稳固，Q3业绩超预期',
    ticker: '300750.SZ',
    tickerName: '宁德时代',
    rating: 'buy',
    institution: '中信证券',
    date: '2024-03-15',
    content: '宁德时代在2024年第一季度的全球市场份额进一步扩大。随着神行电池的量产，其在中低端市场的竞争力显著提升。预计全年净利润将实现25%以上的增长。',
    klineData: [
      { date: '03-15', open: 175.2, close: 180.5, high: 182.1, low: 174.8, volume: 12000 },
      { date: '03-18', open: 180.5, close: 178.2, high: 181.5, low: 177.0, volume: 10500 },
      { date: '03-19', open: 178.2, close: 182.4, high: 183.0, low: 177.5, volume: 11200 },
      { date: '03-20', open: 182.4, close: 185.1, high: 186.2, low: 181.8, volume: 13000 },
      { date: '03-21', open: 185.1, close: 190.2, high: 191.0, low: 184.5, volume: 15400 },
      { date: '03-22', open: 190.2, close: 188.5, high: 192.5, low: 187.2, volume: 14000 },
      { date: '03-25', open: 188.5, close: 192.8, high: 194.0, low: 188.0, volume: 12800 },
    ]
  },
  {
    id: '2',
    title: '贵州茅台：提价效应显现，高端白酒韧性凸显',
    ticker: '600519.SH',
    tickerName: '贵州茅台',
    rating: 'hold',
    institution: '华泰证券',
    date: '2024-03-10',
    content: '贵州茅台近期上调出厂价对表内利润有直接贡献。虽然行业整体增速放缓，但高端品牌溢价能力依然强劲。建议维持持有，关注渠道改革进展。',
    klineData: [
      { date: '03-10', open: 1680, close: 1695, high: 1705, low: 1675, volume: 5400 },
      { date: '03-11', open: 1695, close: 1702, high: 1715, low: 1690, volume: 4800 },
      { date: '03-12', open: 1702, close: 1688, high: 1710, low: 1680, volume: 5100 },
      { date: '03-13', open: 1688, close: 1682, high: 1695, low: 1675, volume: 4200 },
      { date: '03-14', open: 1682, close: 1685, high: 1690, low: 1678, volume: 3900 },
      { date: '03-15', open: 1685, close: 1688, high: 1695, low: 1682, volume: 4500 },
    ]
  },
  {
    id: '3',
    title: '万科A：行业筑底期，维持谨慎观望',
    ticker: '000002.SZ',
    tickerName: '万科A',
    rating: 'sell',
    institution: '中金公司',
    date: '2024-02-28',
    content: '房地产市场销售端仍未见明显改善。万科虽然财务相对稳健，但在整体下行压力下，短期估值提振困难。建议暂时回避。',
    klineData: [
      { date: '02-28', open: 10.2, close: 9.8, high: 10.3, low: 9.7, volume: 85000 },
      { date: '02-29', open: 9.8, close: 9.5, high: 9.9, low: 9.4, volume: 92000 },
      { date: '03-01', open: 9.5, close: 9.3, high: 9.6, low: 9.2, volume: 78000 },
      { date: '03-04', open: 9.3, close: 9.1, high: 9.4, low: 9.0, volume: 81000 },
      { date: '03-05', open: 9.1, close: 8.9, high: 9.2, low: 8.8, volume: 105000 },
    ]
  }
];

const RatingBadge: React.FC<{ rating: Rating }> = ({ rating }) => {
  const styles = {
    buy: "bg-error-container/20 text-error border-error-container/30",
    hold: "bg-surface-container-highest text-on-surface-variant border-surface-container-highest",
    sell: "bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20"
  };
  const labels = { buy: "买入", hold: "维持", sell: "卖出" };
  
  return (
    <span className={cn(
      "px-3 py-1 rounded-md text-xs font-black border",
      styles[rating]
    )}>
      {labels[rating]}
    </span>
  );
};

export const Reports: React.FC = () => {
  const [selectedReport, setSelectedReport] = useState<ResearchReport | null>(mockReports[0]);

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-extrabold font-headline text-primary tracking-tight">精选研究报告</h1>
          <p className="text-on-surface-variant mt-3 font-medium">来自头部券商与机构的深度价值挖掘。</p>
        </div>
        <button type="button" className="flex items-center gap-2 px-6 py-3 bg-primary text-surface rounded-2xl font-bold hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20">
          <Plus size={20} strokeWidth={3} />
          撰写/导入研报
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left: Report List */}
        <div className="lg:col-span-12 xl:col-span-5 space-y-5">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 bg-surface-container-highest px-4 py-2.5 rounded-xl border border-outline-variant/10 flex items-center gap-3">
              <Search size={18} className="text-on-surface-variant" />
              <input type="text" placeholder="搜索研报、机构或代码..." className="bg-transparent border-none outline-none text-sm w-full" />
            </div>
            <button type="button" aria-label="筛选研报" className="p-2.5 bg-surface-container-low rounded-xl border border-outline-variant/10 hover:bg-surface-dim transition-colors">
              <Filter size={18} className="text-primary" />
            </button>
          </div>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            {mockReports.map((report) => (
              <div 
                key={report.id}
                onClick={() => setSelectedReport(report)}
                className={cn(
                  "p-6 rounded-[2rem] cursor-pointer transition-all duration-300 border-2",
                  selectedReport?.id === report.id 
                    ? "bg-surface-container-low border-primary shadow-lg scale-[1.02]" 
                    : "bg-surface-container-lowest border-transparent hover:bg-surface-container-low/50"
                )}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-on-surface-variant/60 uppercase tracking-widest font-mono">
                      {report.ticker}
                    </span>
                    <h3 className="font-headline font-extrabold text-primary">{report.tickerName}</h3>
                  </div>
                  <RatingBadge rating={report.rating} />
                </div>
                <h4 className="font-headline font-bold text-lg text-primary leading-tight line-clamp-2">
                  {report.title}
                </h4>
                <div className="flex items-center gap-4 mt-4 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
                  <span className="flex items-center gap-1.5">
                    <Building size={12} className="text-primary" />
                    {report.institution}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-primary" />
                    {report.date}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Report Detail & Chart */}
        <div className="lg:col-span-12 xl:col-span-7">
          {selectedReport ? (
            <div className="bg-surface-container-lowest rounded-[3rem] p-10 shadow-sm border border-outline-variant/10 h-full animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-8 border-b border-surface-container-highest">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <RatingBadge rating={selectedReport.rating} />
                    <span className="text-sm font-black text-primary uppercase font-mono tracking-wider">{selectedReport.ticker}</span>
                  </div>
                  <h2 className="text-3xl font-[900] font-headline text-primary tracking-tight leading-tight max-w-lg">
                    {selectedReport.title}
                  </h2>
                </div>
                <div className="flex flex-col items-end">
                   <p className="text-xs font-black text-on-surface-variant uppercase tracking-[0.2em] mb-1">{selectedReport.institution}</p>
                   <p className="text-sm font-bold text-primary">{selectedReport.date}</p>
                </div>
              </div>

              {/* Chart Placeholder */}
              <div className="mt-10 mb-10 h-64 w-full bg-surface-container-low rounded-[2rem] p-6">
                <div className="flex justify-between items-center mb-4">
                  <h5 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] flex items-center gap-2">
                    自发布日起行情走势
                    <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />
                  </h5>
                  <div className="flex gap-4">
                     <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-error" />
                        <span className="text-[9px] font-bold text-on-surface-variant">股价</span>
                     </div>
                     <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary/20" />
                        <span className="text-[9px] font-bold text-on-surface-variant">成交量</span>
                     </div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={selectedReport.klineData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}
                    />
                    <YAxis 
                      yAxisId="left"
                      orientation="left" 
                      domain={['auto', 'auto']}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}
                    />
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      tick={false}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', background: '#fff' }}
                      itemStyle={{ fontWeight: 800, fontSize: '12px' }}
                    />
                    {/* Simplified Candle simulation with Bar */}
                    <Bar 
                      yAxisId="right"
                      dataKey="volume" 
                      fill="rgba(0, 52, 62, 0.1)" 
                      radius={[4, 4, 0, 0]}
                    />
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="close" 
                      stroke="#ba1a1a" 
                      strokeWidth={3} 
                      dot={{ r: 4, fill: '#ba1a1a', strokeWidth: 0 }} 
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-6">
                <h5 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] border-b border-primary/10 pb-2 inline-block">核心观点摘要</h5>
                <p className="text-on-surface-variant font-medium leading-relaxed indent-8 text-lg">
                  {selectedReport.content}
                </p>
                <button type="button" className="mt-8 flex items-center gap-2 text-sm font-black text-primary hover:gap-4 transition-all group">
                  阅读全文报告
                  <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-surface-container-low rounded-[3rem] border border-dashed border-primary/20">
              <div className="text-center space-y-4">
                <FileText size={48} className="mx-auto text-primary/20" />
                <p className="text-on-surface-variant font-bold">选择一份研报查看详情</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
