import React from 'react';
import { 
  Plus, 
  MoreVertical,
  TrendingUp,
  TrendingDown,
  LayoutGrid,
  Rows,
  Building2,
  CalendarDays
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface StockItem {
  id: string;
  name: string;
  sector: string;
  price: number;
  vol: string;
  pct: number;
}

interface SectorGroup {
  name: string;
  stocks: StockItem[];
}

const watchListData: SectorGroup[] = [
  {
    name: '新能源产业链',
    stocks: [
      { id: '300750', name: '宁德时代', sector: '锂电池', price: 182.45, vol: '12.4M', pct: 2.34 },
      { id: '002594', name: '比亚迪', sector: '新能源车', price: 245.60, vol: '18.2M', pct: 1.12 },
      { id: '601012', name: '隆基绿能', sector: '光伏设备', price: 23.85, vol: '35.1M', pct: -0.85 },
    ]
  },
  {
    name: '食品饮料',
    stocks: [
      { id: '600519', name: '贵州茅台', sector: '白酒', price: 1658.00, vol: '2.1M', pct: 0.45 },
    ]
  },
  {
    name: '大金融',
    stocks: [
      { id: '600036', name: '招商银行', sector: '股份制银行', price: 32.15, vol: '45.8M', pct: -1.20 },
    ]
  }
];

export const Watchlist: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto space-y-10">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2 border-b border-surface-container-highest/20">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-4xl font-[800] font-headline text-primary tracking-tight">我的自选</h2>
            <span className="text-[10px] font-black text-on-surface-variant bg-surface-container-low px-2.5 py-1 rounded-full uppercase tracking-widest border border-outline-variant/10">
              实时数据
            </span>
          </div>
          <p className="text-sm font-medium text-on-surface-variant max-w-2xl leading-relaxed">
            监控和管理您的 A 股核心资产池，按行业板块、机构评级或自定义主题进行分类。
          </p>
        </div>
        
        <div className="flex items-center gap-1.5 p-1 bg-surface-container-low rounded-full border border-outline-variant/10 shadow-inner">
          <button className="flex items-center gap-2 px-6 py-2 rounded-full bg-tertiary-fixed text-primary text-[10px] font-black uppercase tracking-widest shadow-sm">
            <LayoutGrid size={14} className="stroke-[3px]" />
            按行业
          </button>
          <button className="flex items-center gap-2 px-6 py-2 rounded-full text-on-surface-variant hover:text-primary transition-all text-[10px] font-black uppercase tracking-widest">
            <Building2 size={14} />
            按机构
          </button>
          <button className="flex items-center gap-2 px-6 py-2 rounded-full text-on-surface-variant hover:text-primary transition-all text-[10px] font-black uppercase tracking-widest">
            <Rows size={14} />
            平铺
          </button>
        </div>
      </div>

      {/* Grouped List Content */}
      <div className="space-y-14">
        {watchListData.map((group) => (
          <section key={group.name} className="animate-in slide-in-from-bottom duration-700">
            <div className="sticky top-16 z-20 bg-surface/90 backdrop-blur-md py-4 mb-6 flex justify-between items-center group cursor-default">
              <div className="flex items-center gap-4">
                <div className="h-6 w-1.5 bg-gradient-to-b from-primary to-primary-container rounded-full shadow-[0_0_8px_rgba(0,52,62,0.2)]" />
                <h3 className="text-2xl font-[800] font-headline text-primary tracking-tight group-hover:translate-x-1 transition-transform">{group.name}</h3>
                <span className="text-[10px] font-black text-on-surface-variant bg-surface-container-highest px-3 py-1 rounded-full border border-outline-variant/10">
                  {group.stocks.length} 个标的
                </span>
              </div>
              <button className="flex items-center gap-2 text-[10px] font-black text-primary hover:underline transition-all">
                <Plus size={14} className="stroke-[3px]" />
                添加标的
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {group.stocks.map((stock) => (
                <div 
                  key={stock.id} 
                  className={cn(
                    "group bg-surface-container-lowest rounded-[1.5rem] p-6 flex flex-col sm:flex-row items-center justify-between",
                    "border border-transparent hover:border-outline-variant/20 hover:shadow-xl hover:shadow-primary/5 transition-all duration-500 cursor-pointer overflow-hidden relative"
                  )}
                >
                  <div className="flex items-center gap-6 w-full sm:w-1/3">
                    <div className="w-14 h-14 rounded-2xl bg-surface-container-low flex items-center justify-center text-primary font-black text-xs font-headline group-hover:rotate-6 transition-transform">
                      {stock.id}
                    </div>
                    <div>
                      <h4 className="font-headline font-[800] text-xl text-primary leading-none group-hover:text-primary-container transition-colors mb-2">
                        {stock.name}
                      </h4>
                      <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em]">{stock.sector}</p>
                    </div>
                  </div>

                  <div className="w-full sm:w-1/4 mt-4 sm:mt-0 flex flex-col sm:items-end">
                    <div className="font-headline font-[800] text-2xl text-on-surface tabular-nums">¥ {stock.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <CalendarDays size={12} className="text-on-surface-variant/40" />
                      <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest font-mono">Vol: {stock.vol}</span>
                    </div>
                  </div>

                  <div className="w-full sm:w-1/4 mt-4 sm:mt-0 flex justify-between sm:justify-end items-center gap-6">
                    <div className={cn(
                      "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-black shadow-sm",
                      // Matching Chinese market standard: RED is UP, GREEN is DOWN
                      stock.pct >= 0 
                        ? "bg-error-container/40 text-error" 
                        : "bg-tertiary-container/10 text-tertiary-container"
                    )}>
                      {stock.pct >= 0 ? <TrendingUp size={16} className="stroke-[3px]" /> : <TrendingDown size={16} className="stroke-[3px]" />}
                      {stock.pct >= 0 ? '+' : ''}{stock.pct.toFixed(2)}%
                    </div>
                    
                    <button className="p-3 text-on-surface-variant hover:text-primary hover:bg-surface-container-low rounded-xl transition-all">
                      <MoreVertical size={20} />
                    </button>
                  </div>
                  
                  {/* Subtle hover effect line */}
                  <div className="absolute bottom-0 left-0 h-1 bg-primary w-0 group-hover:w-full transition-all duration-700" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
