import React from 'react';
import { 
  Plus, 
  Download, 
  Filter, 
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Info
} from 'lucide-react';
import { 
  PieChart as RPieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer 
} from 'recharts';
import { cn } from '@/src/lib/utils';

const allocationData = [
  { name: '信息技术', value: 45, color: '#00343e' },
  { name: '可选消费', value: 25, color: '#004c59' },
  { name: '医疗保健', value: 15, color: '#86d2e5' },
  { name: '现金', value: 15, color: '#d0e6f3' },
];

const holdings = [
  { symbol: 'AAPL', name: '苹果公司', quantity: 500, cost: 145.20, price: 173.50, profit: 14150.00, pct: 19.49 },
  { symbol: 'MSFT', name: '微软', quantity: 300, cost: 310.00, price: 335.20, profit: 7560.00, pct: 8.12 },
  { symbol: 'TSLA', name: '特斯拉', quantity: 150, cost: 240.50, price: 212.80, profit: -4155.00, pct: -11.51 },
  { symbol: 'NVDA', name: '英伟达', quantity: 100, cost: 280.00, price: 450.00, profit: 17000.00, pct: 60.71 },
];

export const Portfolio: React.FC = () => {
  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-10 flex justify-between items-end">
        <div>
          <h2 className="font-headline text-4xl font-[800] tracking-tight text-primary mb-2">投资组合概览</h2>
          <p className="font-sans text-on-surface-variant text-sm font-medium">截至 2023年10月24日 15:30 (CST)</p>
        </div>
        <div className="flex gap-4">
          <button className="bg-transparent border border-outline-variant/30 text-primary px-5 py-2.5 rounded-xl font-headline font-bold text-sm hover:bg-surface-container-low transition-colors">
            下载报告
          </button>
          <button className="bg-primary text-surface px-6 py-2.5 rounded-xl font-headline font-bold text-sm hover:opacity-90 transition-all duration-200 flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95">
            <Plus size={20} className="stroke-[3px]" />
            新建交易
          </button>
        </div>
      </div>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Assets */}
        <div className="bg-surface-container-low rounded-3xl p-8 relative overflow-hidden flex flex-col justify-between h-44 shadow-sm border border-outline-variant/10">
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          <div>
            <p className="font-headline text-xs font-[800] uppercase tracking-widest text-on-surface-variant mb-2 flex items-center gap-2">
              总资产
              <Info size={12} className="opacity-50" />
            </p>
            <h3 className="font-headline text-3xl font-[800] text-primary tracking-tight">¥1,245,670.50</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-error-container/10 text-error text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1 shadow-sm border border-error-container/10">
              <ArrowUp size={12} />
              +12.4%
            </span>
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">年初至今</span>
          </div>
        </div>

        {/* Daily P&L */}
        <div className="bg-surface-container-low rounded-3xl p-8 flex flex-col justify-between h-44 shadow-sm border border-outline-variant/10">
          <div>
            <p className="font-headline text-xs font-[800] uppercase tracking-widest text-on-surface-variant mb-2">今日盈亏</p>
            <h3 className="font-headline text-3xl font-[800] text-error tracking-tight">+¥8,432.00</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-error font-headline tracking-tight">+0.68%</span>
          </div>
        </div>

        {/* Cash Available */}
        <div className="bg-surface-container-low rounded-3xl p-8 flex flex-col justify-between h-44 shadow-sm border border-outline-variant/10">
          <div>
            <p className="font-headline text-xs font-[800] uppercase tracking-widest text-on-surface-variant mb-2">可用现金</p>
            <h3 className="font-headline text-3xl font-[800] text-on-surface tracking-tight">¥156,000.00</h3>
          </div>
          <div>
            <div className="w-full bg-surface-container-highest rounded-full h-1.5 mb-2 overflow-hidden">
              <div className="bg-primary h-full rounded-full" style={{ width: '12.5%' }} />
            </div>
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest leading-none">占总资产 12.5%</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Holdings & Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Holdings Table */}
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-[2rem] p-8 shadow-sm border border-outline-variant/10">
          <div className="flex justify-between items-center mb-8">
            <h4 className="font-headline text-xl font-[800] text-primary tracking-tight">持仓明细</h4>
            <div className="flex gap-2">
              <button className="p-2 text-on-surface-variant hover:text-primary transition-all rounded-lg">
                <Filter size={18} />
              </button>
              <button className="p-2 text-on-surface-variant hover:text-primary transition-all rounded-lg">
                <MoreVertical size={18} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-surface-container-highest">
                  <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4">代码 / 名称</th>
                  <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4 text-right">持仓数量</th>
                  <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4 text-right">平均成本</th>
                  <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4 text-right">当前价</th>
                  <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4 text-right">总收益</th>
                </tr>
              </thead>
              <tbody className="divide-y-0 text-sm">
                {holdings.map((stock) => (
                  <tr key={stock.symbol} className="border-b border-surface-container-highest/60 hover:bg-surface-container-low transition-colors group">
                    <td className="py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-primary text-base leading-none mb-1">{stock.symbol}</span>
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{stock.name}</span>
                      </div>
                    </td>
                    <td className="py-5 text-right font-bold text-primary tabular-nums">{stock.quantity}</td>
                    <td className="py-5 text-right font-mono text-on-surface-variant text-xs tabular-nums">¥{stock.cost.toFixed(2)}</td>
                    <td className="py-5 text-right font-mono font-bold text-primary text-xs tabular-nums">¥{stock.price.toFixed(2)}</td>
                    <td className="py-5 text-right">
                      <div className="flex flex-col items-end">
                        <span className={cn(
                          "font-bold font-mono tracking-tight text-sm",
                          stock.profit >= 0 ? "text-error" : "text-tertiary-container"
                        )}>
                          {stock.profit >= 0 ? '+' : ''}¥{stock.profit.toLocaleString()}
                        </span>
                        <span className={cn(
                          "text-[9px] font-black px-1.5 py-0.5 rounded-md self-end mt-1",
                          stock.pct >= 0 ? "bg-error-container/40 text-error" : "bg-tertiary-container/10 text-tertiary-container"
                        )}>
                          {stock.pct >= 0 ? '+' : ''}{stock.pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Asset Allocation Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10 h-full flex flex-col">
            <h4 className="font-headline text-xl font-[800] text-primary tracking-tight mb-10">资产配置</h4>
            
            <div className="relative h-64 mb-10">
              <ResponsiveContainer width="100%" height="100%">
                <RPieChart>
                  <Pie
                    data={allocationData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {allocationData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </RPieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-headline font-[900] text-2xl text-primary leading-none">4 类</span>
                <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mt-1">主营板块</span>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              {allocationData.map((item) => (
                <div key={item.name} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full transition-transform group-hover:scale-125 duration-300" style={{ backgroundColor: item.color }} />
                    <span className="text-sm font-bold text-primary">{item.name}</span>
                  </div>
                  <span className="font-mono text-sm font-bold text-on-surface-variant">{item.value}%</span>
                </div>
              ))}
            </div>

            <button className="w-full mt-10 py-3 bg-surface-container-highest text-primary text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-surface-dim transition-all">
              查看板块热力图
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
