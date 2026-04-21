import React, { useState } from 'react';
import { 
  Plus, 
  RotateCcw, 
  Play, 
  Download, 
  Columns, 
  Filter,
  Check,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

const screeningResults = [
  { symbol: '600519.SH', name: '贵州茅台', price: 1688.00, change: 1.24, marketCap: '21,200.5', pe: 28.4, initial: 'M' },
  { symbol: '300750.SZ', name: '宁德时代', price: 188.50, change: -0.85, marketCap: '8,290.1', pe: 18.2, initial: 'C' },
  { symbol: '002594.SZ', name: '比亚迪', price: 205.10, change: 2.10, marketCap: '5,970.8', pe: 22.5, initial: 'B' },
  { symbol: '600036.SH', name: '招商银行', price: 32.40, change: 0.45, marketCap: '8,170.2', pe: 5.8, initial: 'Z' },
];

export const Screener: React.FC = () => {
  const [activeExchanges, setActiveExchanges] = useState(['沪深']);
  const [activeOwnership, setActiveOwnership] = useState(['央企', '民企']);

  const toggleFilter = (list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>, item: string) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-4xl font-extrabold font-headline text-primary tracking-tight">高级选股器</h1>
          <p className="text-on-surface-variant mt-2 font-medium">通过精准过滤发现高潜力中国 A 股标的。</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-6 py-2.5 rounded-xl border border-outline-variant/20 text-on-surface-variant font-bold text-sm hover:bg-surface-container-low transition-colors">
            <RotateCcw size={16} />
            一键清除
          </button>
          <button className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-surface font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all">
            <Play size={16} fill="currentColor" />
            运行筛选
          </button>
        </div>
      </div>

      {/* Filter Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Numerical Constraints */}
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-3xl p-8 shadow-sm border border-outline-variant/10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-tertiary-fixed/10 rounded-bl-full pointer-events-none" />
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
            <Filter size={14} className="text-primary" />
            Numerical Constraints
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { label: '市盈率 (PE) <', val: '15' },
              { label: '股息率 (%) >', val: '3.5' },
              { label: '市值 (亿 ¥) >', val: '500' },
            ].map((f) => (
              <div key={f.label} className="space-y-3">
                <label className="flex items-center gap-3 group cursor-pointer">
                  <div className="w-5 h-5 rounded border border-outline flex items-center justify-center bg-surface transition-colors group-hover:border-primary">
                    <Check size={12} className="text-primary stroke-[3px]" />
                  </div>
                  <span className="text-sm font-bold text-on-surface-variant group-hover:text-primary transition-colors">
                    {f.label}
                  </span>
                </label>
                <div className="relative">
                  <input 
                    type="text" 
                    defaultValue={f.val} 
                    className="w-full bg-surface-container-low border-b-2 border-outline/20 focus:border-primary px-4 py-3 text-sm font-bold text-on-surface outline-none transition-all rounded-t-xl text-right"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Categorical Attributes */}
        <div className="lg:col-span-4 bg-surface-container-lowest rounded-3xl p-8 shadow-sm border border-outline-variant/10">
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
            <Plus size={16} className="text-primary" />
            Attributes
          </h3>

          <div className="space-y-8">
            <div>
              <p className="text-[10px] font-black text-secondary uppercase tracking-[0.15em] mb-4">公司性质 (Ownership)</p>
              <div className="flex flex-wrap gap-2">
                {['央企', '地方国企', '民企'].map(o => (
                  <button 
                    key={o}
                    onClick={() => toggleFilter(activeOwnership, setActiveOwnership, o)}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-xs font-bold transition-all",
                      activeOwnership.includes(o) 
                        ? "bg-tertiary-fixed text-primary" 
                        : "bg-surface-container text-on-surface-variant hover:bg-surface-container-highest"
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black text-secondary uppercase tracking-[0.15em] mb-4">上市地点 (Exchange)</p>
              <div className="flex flex-wrap gap-2">
                {['沪深', '创业板', '北交所'].map(e => (
                  <button 
                    key={e}
                    onClick={() => toggleFilter(activeExchanges, setActiveExchanges, e)}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-xs font-bold transition-all",
                      activeExchanges.includes(e) 
                        ? "bg-tertiary-fixed text-primary" 
                        : "bg-surface-container text-on-surface-variant hover:bg-surface-container-highest"
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-surface-container-lowest rounded-3xl shadow-sm border border-outline-variant/10 overflow-hidden">
        <div className="px-8 py-6 border-b border-surface-container flex justify-between items-center bg-surface-bright/50 backdrop-blur-sm">
          <h3 className="text-lg font-bold font-headline text-primary flex items-center gap-3">
            筛选结果
            <span className="text-sm font-medium text-on-surface-variant bg-surface-container px-3 py-1 rounded-full">42 标的命中</span>
          </h3>
          <div className="flex gap-2">
            <button className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all rounded-lg">
              <Download size={20} />
            </button>
            <button className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all rounded-lg">
              <Columns size={20} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50 text-[10px] font-black text-on-surface-variant uppercase tracking-[0.15em]">
                <th className="px-8 py-4 font-black">代码/简称</th>
                <th className="px-8 py-4 font-black text-right">最新价 (¥)</th>
                <th className="px-8 py-4 font-black text-right">涨跌幅</th>
                <th className="px-8 py-4 font-black text-right">市值 (亿 RMB)</th>
                <th className="px-8 py-4 font-black text-right">市盈率 (TTM)</th>
              </tr>
            </thead>
            <tbody className="divide-y-0">
              {screeningResults.map((stock, i) => (
                <tr key={stock.symbol} className={cn(
                  "group cursor-pointer transition-colors border-b-2 border-surface-container-low/30",
                  "hover:bg-surface-container-low/50"
                )}>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs transition-transform group-hover:scale-110 duration-300",
                        activeExchanges.includes('沪深') ? "bg-primary/5 text-primary" : "bg-secondary/10 text-secondary"
                      )}>
                        {stock.initial}
                      </div>
                      <div>
                        <div className="font-bold text-primary text-base group-hover:text-primary-container transition-colors">
                          {stock.name}
                        </div>
                        <div className="text-[10px] font-bold text-on-surface-variant/70 font-mono tracking-wider">
                          {stock.symbol}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right font-bold text-on-surface tabular-nums">
                    {stock.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-8 py-5 text-right">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black shadow-sm",
                      stock.change >= 0 
                        ? "bg-error-container/40 text-error" 
                        : "bg-tertiary-container/10 text-tertiary-container"
                    )}>
                      {stock.change >= 0 ? <TrendingUp size={14} className="stroke-[3px]" /> : <TrendingDown size={14} className="stroke-[3px]" />}
                      {stock.change >= 0 ? '+' : ''}{stock.change}%
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right font-medium text-on-surface-variant font-mono text-xs">
                    {stock.marketCap}
                  </td>
                  <td className="px-8 py-5 text-right font-medium text-on-surface-variant font-mono text-xs">
                    {stock.pe}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-8 py-5 bg-surface-bright/50 border-t border-surface-container flex items-center justify-between">
          <span className="text-xs font-bold text-on-surface-variant/70">显示 1 到 4 共 42 条结果</span>
          <div className="flex gap-1.5">
            <button className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-all disabled:opacity-30" disabled>
              <ChevronLeft size={18} />
            </button>
            <button className="px-3.5 py-1.5 rounded-lg text-sm font-black bg-primary text-surface shadow-sm">1</button>
            <button className="px-3.5 py-1.5 rounded-lg text-sm font-bold text-on-surface hover:bg-surface-container transition-all">2</button>
            <button className="px-3.5 py-1.5 rounded-lg text-sm font-bold text-on-surface hover:bg-surface-container transition-all">3</button>
            <span className="px-2 py-1.5 text-on-surface-variant/50">...</span>
            <button className="px-3.5 py-1.5 rounded-lg text-sm font-bold text-on-surface hover:bg-surface-container transition-all">11</button>
            <button className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-all">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
