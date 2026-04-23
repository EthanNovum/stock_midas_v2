import React, { useEffect, useState } from 'react';
import {
  Plus,
  Download,
  Filter,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Info,
  Edit3,
  Trash2,
  X,
  Save,
  Search
} from 'lucide-react';
import {
  PieChart as RPieChart,
  Pie,
  Cell,
  ResponsiveContainer
} from 'recharts';
import { cn } from '@/src/lib/utils';

type TradeSide = 'buy' | 'sell' | 'dividend';

interface PortfolioSummary {
  portfolioId: number;
  asOf: string;
  totalAssets: number;
  ytdPct: number;
  dailyPnl: number;
  dailyPnlPct: number;
  cash: number;
  cashPct: number;
}

interface HoldingItem {
  symbol: string;
  name: string;
  quantity: number;
  cost: number;
  price: number;
  profit: number;
  pct: number;
}

interface AllocationItem {
  name: string;
  value: number;
  color: string;
}

interface TradeItem {
  id: number;
  portfolioId: number;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  totalAmount: number;
  tradedAt: string;
}

interface TradeFormState {
  symbol: string;
  side: TradeSide;
  quantity: string;
  price: string;
  tradedAt: string;
}

interface SearchResultItem {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  latestPrice?: number | null;
  latestTradeDate?: string | null;
}

const EMPTY_SUMMARY: PortfolioSummary = {
  portfolioId: 1,
  asOf: '',
  totalAssets: 0,
  ytdPct: 0,
  dailyPnl: 0,
  dailyPnlPct: 0,
  cash: 0,
  cashPct: 0,
};

const getTodayDateValue = () => {
  const date = new Date();
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
};

const createEmptyTradeForm = (): TradeFormState => ({
  symbol: '',
  side: 'buy',
  quantity: '',
  price: '',
  tradedAt: getTodayDateValue(),
});

const formatCurrency = (value: number) => `¥${value.toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const formatSignedCurrency = (value: number) => `${value >= 0 ? '+' : ''}${formatCurrency(value)}`;

const formatSignedPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatDateTime = (value: string) => {
  if (!value) return '尚未更新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const toDatetimeLocalValue = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const toDateInputValue = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return toDatetimeLocalValue(value).slice(0, 10);
};

const formatTradeDate = (value: string) => {
  if (!value) return '未记录';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const getTradeSideLabel = (side: TradeSide) => {
  if (side === 'buy') return '买入';
  if (side === 'sell') return '卖出';
  return '分红';
};

const toPriceInputValue = (value?: number | null) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(value) : ''
);

export const Portfolio: React.FC = () => {
  const [summary, setSummary] = useState<PortfolioSummary>(EMPTY_SUMMARY);
  const [holdings, setHoldings] = useState<HoldingItem[]>([]);
  const [allocationData, setAllocationData] = useState<AllocationItem[]>([]);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTrade, setIsSavingTrade] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tradeMessage, setTradeMessage] = useState<string | null>(null);
  const [isTradeDialogOpen, setIsTradeDialogOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<TradeItem | null>(null);
  const [tradeForm, setTradeForm] = useState<TradeFormState>(createEmptyTradeForm);
  const [stockSearchResults, setStockSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearchingStocks, setIsSearchingStocks] = useState(false);
  const [isTradePriceDirty, setIsTradePriceDirty] = useState(false);

  const readErrorMessage = async (response: Response) => {
    try {
      const payload = await response.json();
      if (typeof payload?.detail === 'string') return payload.detail;
      if (payload?.detail?.message) return payload.detail.message;
      return `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  };

  const loadPortfolio = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [summaryResponse, holdingsResponse, allocationResponse, tradesResponse] = await Promise.all([
        fetch('/api/v1/portfolio/summary'),
        fetch('/api/v1/portfolio/holdings'),
        fetch('/api/v1/portfolio/allocation'),
        fetch('/api/v1/portfolio/trades'),
      ]);

      const failedResponse = [summaryResponse, holdingsResponse, allocationResponse, tradesResponse]
        .find((response) => !response.ok);
      if (failedResponse) {
        throw new Error(await readErrorMessage(failedResponse));
      }

      const [summaryPayload, holdingsPayload, allocationPayload, tradesPayload] = await Promise.all([
        summaryResponse.json() as Promise<PortfolioSummary>,
        holdingsResponse.json() as Promise<{ items?: HoldingItem[] }>,
        allocationResponse.json() as Promise<{ items?: AllocationItem[] }>,
        tradesResponse.json() as Promise<{ items?: TradeItem[] }>,
      ]);

      setSummary(summaryPayload);
      setHoldings(holdingsPayload.items ?? []);
      setAllocationData(allocationPayload.items ?? []);
      setTrades(tradesPayload.items ?? []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '未知错误');
      setSummary(EMPTY_SUMMARY);
      setHoldings([]);
      setAllocationData([]);
      setTrades([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPortfolio();
  }, []);

  useEffect(() => {
    const keyword = tradeForm.symbol.trim();
    if (!isTradeDialogOpen || keyword.length < 1) {
      setStockSearchResults([]);
      setIsSearchingStocks(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearchingStocks(true);
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(keyword)}&limit=8`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }
        const payload = await response.json() as { items?: SearchResultItem[] };
        const stockResults = (payload.items ?? []).filter((item) => item.type === 'stock');
        setStockSearchResults(stockResults);

        const exactMatch = stockResults.find((item) => item.id.toUpperCase() === keyword.toUpperCase());
        const latestPrice = toPriceInputValue(exactMatch?.latestPrice);
        if (latestPrice && !isTradePriceDirty) {
          setTradeForm((form) => ({ ...form, price: latestPrice }));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStockSearchResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingStocks(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [isTradeDialogOpen, isTradePriceDirty, tradeForm.symbol]);

  const openCreateTradeDialog = () => {
    setEditingTrade(null);
    setTradeForm(createEmptyTradeForm());
    setTradeMessage(null);
    setIsTradePriceDirty(false);
    setIsTradeDialogOpen(true);
  };

  const openEditTradeDialog = (trade: TradeItem) => {
    setEditingTrade(trade);
    setTradeForm({
      symbol: trade.symbol,
      side: trade.side,
      quantity: String(trade.quantity),
      price: String(trade.price),
      tradedAt: toDateInputValue(trade.tradedAt),
    });
    setTradeMessage(null);
    setIsTradePriceDirty(true);
    setIsTradeDialogOpen(true);
  };

  const closeTradeDialog = () => {
    if (isSavingTrade) return;
    setIsTradeDialogOpen(false);
    setEditingTrade(null);
    setTradeForm(createEmptyTradeForm());
    setIsTradePriceDirty(false);
  };

  const submitTrade = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingTrade(true);
    setTradeMessage(null);

    const quantity = Number(tradeForm.quantity);
    const price = Number(tradeForm.price);
    const symbol = tradeForm.symbol.trim().toUpperCase();

    if (!symbol || !Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price <= 0) {
      setTradeMessage('请填写有效的证券代码、数量和价格。');
      setIsSavingTrade(false);
      return;
    }

    const payload = {
      portfolioId: summary.portfolioId || 1,
      symbol,
      side: tradeForm.side,
      quantity,
      price,
      tradedAt: tradeForm.tradedAt || undefined,
    };

    try {
      const response = await fetch(
        editingTrade ? `/api/v1/portfolio/trades/${editingTrade.id}` : '/api/v1/portfolio/trades',
        {
          method: editingTrade ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setTradeMessage(editingTrade ? '交易记录已更新。' : '交易记录已创建。');
      setIsTradeDialogOpen(false);
      setEditingTrade(null);
      setTradeForm(createEmptyTradeForm());
      setIsTradePriceDirty(false);
      await loadPortfolio();
    } catch (error) {
      setTradeMessage(error instanceof Error ? error.message : '交易保存失败');
    } finally {
      setIsSavingTrade(false);
    }
  };

  const deleteTrade = async (trade: TradeItem) => {
    const confirmed = window.confirm(`删除 ${trade.symbol} ${getTradeSideLabel(trade.side)}记录？`);
    if (!confirmed) return;

    setTradeMessage(null);
    try {
      const response = await fetch(`/api/v1/portfolio/trades/${trade.id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      await loadPortfolio();
    } catch (error) {
      setTradeMessage(error instanceof Error ? error.message : '交易删除失败');
    }
  };

  const downloadReport = () => {
    window.location.assign('/api/v1/portfolio/report?format=csv');
  };

  const dailyTrendClass = summary.dailyPnl >= 0 ? 'text-error' : 'text-tertiary-container';

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="mb-10 flex flex-col gap-5 md:flex-row md:justify-between md:items-end">
        <div>
          <h2 className="font-headline text-4xl font-[800] tracking-tight text-primary mb-2">投资组合概览</h2>
          <p className="font-sans text-on-surface-variant text-sm font-medium">
            截至 {formatDateTime(summary.asOf)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={downloadReport}
            className="bg-transparent border border-outline-variant/30 text-primary px-5 py-2.5 rounded-xl font-headline font-bold text-sm hover:bg-surface-container-low transition-colors flex items-center gap-2"
          >
            <Download size={18} />
            下载报告
          </button>
          <button
            type="button"
            onClick={openCreateTradeDialog}
            className="bg-primary text-surface px-6 py-2.5 rounded-xl font-headline font-bold text-sm hover:opacity-90 transition-all duration-200 flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95"
          >
            <Plus size={20} className="stroke-[3px]" />
            新建交易
          </button>
        </div>
      </div>

      {(errorMessage || tradeMessage) && (
        <div className={cn(
          "rounded-2xl border px-6 py-4 text-sm font-bold",
          errorMessage
            ? "border-tertiary-container/20 bg-tertiary-container/10 text-tertiary-container"
            : "border-primary/20 bg-primary/5 text-primary"
        )}>
          {errorMessage ? `投资组合数据加载失败: ${errorMessage}` : tradeMessage}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-container-low rounded-3xl p-8 relative overflow-hidden flex flex-col justify-between h-44 shadow-sm border border-outline-variant/10">
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          <div>
            <p className="font-headline text-xs font-[800] uppercase tracking-widest text-on-surface-variant mb-2 flex items-center gap-2">
              总资产
              <Info size={12} className="opacity-50" />
            </p>
            <h3 className="font-headline text-3xl font-[800] text-primary tracking-tight tabular-nums">
              {formatCurrency(summary.totalAssets)}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1 shadow-sm border",
              summary.ytdPct >= 0
                ? "bg-error-container/10 text-error border-error-container/10"
                : "bg-tertiary-container/10 text-tertiary-container border-tertiary-container/10"
            )}>
              {summary.ytdPct >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {formatSignedPercent(summary.ytdPct)}
            </span>
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">年初至今</span>
          </div>
        </div>

        <div className="bg-surface-container-low rounded-3xl p-8 flex flex-col justify-between h-44 shadow-sm border border-outline-variant/10">
          <div>
            <p className="font-headline text-xs font-[800] uppercase tracking-widest text-on-surface-variant mb-2">净值盈亏</p>
            <h3 className={cn("font-headline text-3xl font-[800] tracking-tight tabular-nums", dailyTrendClass)}>
              {formatSignedCurrency(summary.dailyPnl)}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-bold font-headline tracking-tight", dailyTrendClass)}>
              {formatSignedPercent(summary.dailyPnlPct)}
            </span>
          </div>
        </div>

        <div className="bg-surface-container-low rounded-3xl p-8 flex flex-col justify-between h-44 shadow-sm border border-outline-variant/10">
          <div>
            <p className="font-headline text-xs font-[800] uppercase tracking-widest text-on-surface-variant mb-2">可用现金</p>
            <h3 className="font-headline text-3xl font-[800] text-on-surface tracking-tight tabular-nums">
              {formatCurrency(summary.cash)}
            </h3>
          </div>
          <div>
            <div className="w-full bg-surface-container-highest rounded-full h-1.5 mb-2 overflow-hidden">
              <div className="bg-primary h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, summary.cashPct))}%` }} />
            </div>
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest leading-none">
              占总资产 {summary.cashPct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="bg-surface-container-lowest rounded-2xl p-8 text-center text-sm font-bold text-on-surface-variant">
          正在加载投资组合数据...
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-[2rem] p-8 shadow-sm border border-outline-variant/10">
          <div className="flex justify-between items-center mb-8">
            <h4 className="font-headline text-xl font-[800] text-primary tracking-tight">持仓明细</h4>
            <div className="flex gap-2">
              <button type="button" aria-label="筛选持仓" className="p-2 text-on-surface-variant hover:text-primary transition-all rounded-lg">
                <Filter size={18} />
              </button>
              <button type="button" aria-label="打开持仓菜单" className="p-2 text-on-surface-variant hover:text-primary transition-all rounded-lg">
                <MoreVertical size={18} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
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
                {!isLoading && holdings.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm font-bold text-on-surface-variant">
                      暂无持仓。
                    </td>
                  </tr>
                )}
                {holdings.map((stock) => (
                  <tr key={stock.symbol} className="border-b border-surface-container-highest/60 hover:bg-surface-container-low transition-colors group">
                    <td className="py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-primary text-base leading-none mb-1">{stock.symbol}</span>
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{stock.name}</span>
                      </div>
                    </td>
                    <td className="py-5 text-right font-bold text-primary tabular-nums">{stock.quantity.toLocaleString('zh-CN')}</td>
                    <td className="py-5 text-right font-mono text-on-surface-variant text-xs tabular-nums">{formatCurrency(stock.cost)}</td>
                    <td className="py-5 text-right font-mono font-bold text-primary text-xs tabular-nums">{formatCurrency(stock.price)}</td>
                    <td className="py-5 text-right">
                      <div className="flex flex-col items-end">
                        <span className={cn(
                          "font-bold font-mono tracking-tight text-sm",
                          stock.profit >= 0 ? "text-error" : "text-tertiary-container"
                        )}>
                          {formatSignedCurrency(stock.profit)}
                        </span>
                        <span className={cn(
                          "text-[9px] font-black px-1.5 py-0.5 rounded-md self-end mt-1",
                          stock.pct >= 0 ? "bg-error-container/40 text-error" : "bg-tertiary-container/10 text-tertiary-container"
                        )}>
                          {formatSignedPercent(stock.pct)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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
                    {allocationData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </RPieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-headline font-[900] text-2xl text-primary leading-none">{allocationData.length} 类</span>
                <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mt-1">资产分类</span>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              {allocationData.length === 0 && (
                <div className="text-sm font-bold text-on-surface-variant">暂无资产配置数据。</div>
              )}
              {allocationData.map((item) => (
                <div key={item.name} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full transition-transform group-hover:scale-125 duration-300" style={{ backgroundColor: item.color }} />
                    <span className="text-sm font-bold text-primary">{item.name}</span>
                  </div>
                  <span className="font-mono text-sm font-bold text-on-surface-variant">{item.value.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
          <h4 className="font-headline text-xl font-[800] text-primary tracking-tight">交易记录</h4>
          <button
            type="button"
            onClick={openCreateTradeDialog}
            className="self-start md:self-auto bg-surface-container-highest text-primary px-4 py-2 rounded-xl font-headline font-bold text-xs hover:bg-surface-dim transition-colors flex items-center gap-2"
          >
            <Plus size={16} />
            添加交易
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="border-b border-surface-container-highest">
                <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4">时间</th>
                <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4">代码</th>
                <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4">方向</th>
                <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4 text-right">数量</th>
                <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4 text-right">价格</th>
                <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4 text-right">成交额</th>
                <th className="font-headline text-[10px] font-black uppercase tracking-[0.15em] text-on-surface-variant pb-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {!isLoading && trades.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm font-bold text-on-surface-variant">
                    暂无交易记录。
                  </td>
                </tr>
              )}
              {trades.map((trade) => (
                <tr key={trade.id} className="border-b border-surface-container-highest/60 hover:bg-surface-container-low transition-colors">
                  <td className="py-4 text-xs font-bold text-on-surface-variant">{formatTradeDate(trade.tradedAt)}</td>
                  <td className="py-4 font-bold text-primary">{trade.symbol}</td>
                  <td className="py-4">
                    <span className={cn(
                      "inline-flex items-center rounded-md px-2 py-1 text-[10px] font-black",
                      trade.side === 'buy'
                        ? "bg-error-container/30 text-error"
                        : trade.side === 'sell'
                          ? "bg-tertiary-container/10 text-tertiary-container"
                          : "bg-primary/10 text-primary"
                    )}>
                      {getTradeSideLabel(trade.side)}
                    </span>
                  </td>
                  <td className="py-4 text-right font-mono text-sm font-bold tabular-nums">{trade.quantity.toLocaleString('zh-CN')}</td>
                  <td className="py-4 text-right font-mono text-sm tabular-nums">{formatCurrency(trade.price)}</td>
                  <td className="py-4 text-right font-mono text-sm font-bold tabular-nums">{formatCurrency(trade.totalAmount)}</td>
                  <td className="py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        aria-label="编辑交易"
                        title="编辑交易"
                        onClick={() => openEditTradeDialog(trade)}
                        className="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-highest transition-colors"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label="删除交易"
                        title="删除交易"
                        onClick={() => void deleteTrade(trade)}
                        className="p-2 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/10 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isTradeDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/30 px-4 py-8 backdrop-blur-sm">
          <form
            onSubmit={submitTrade}
            className="w-full max-w-lg bg-surface rounded-2xl border border-outline-variant/20 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-outline-variant/20 px-6 py-5">
              <h3 className="font-headline text-xl font-[800] text-primary">
                {editingTrade ? '编辑交易' : '新建交易'}
              </h3>
              <button
                type="button"
                onClick={closeTradeDialog}
                aria-label="关闭"
                className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-low hover:text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 px-6 py-6">
              {tradeMessage && (
                <div className="rounded-xl border border-tertiary-container/20 bg-tertiary-container/10 px-4 py-3 text-xs font-bold text-tertiary-container">
                  {tradeMessage}
                </div>
              )}

              <div className="relative">
                <span className="mb-2 block text-xs font-black uppercase tracking-widest text-on-surface-variant">证券代码</span>
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                  <input
                    value={tradeForm.symbol}
                    onChange={(event) => setTradeForm((form) => ({ ...form, symbol: event.target.value }))}
                    placeholder="输入证券名称或代码搜索"
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low py-3 pl-11 pr-4 font-mono text-sm font-bold text-primary outline-none focus:border-primary"
                  />
                </div>
                {(isSearchingStocks || stockSearchResults.length > 0) && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-outline-variant/20 bg-surface shadow-xl">
                    {isSearchingStocks && (
                      <div className="px-4 py-3 text-xs font-bold text-on-surface-variant">搜索中...</div>
                    )}
                    {!isSearchingStocks && stockSearchResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          const latestPrice = toPriceInputValue(item.latestPrice);
                          setTradeForm((form) => ({
                            ...form,
                            symbol: item.id,
                            price: latestPrice && !isTradePriceDirty ? latestPrice : form.price,
                          }));
                          setStockSearchResults([]);
                        }}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-surface-container-low"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-primary">{item.title}</span>
                          <span className="block truncate text-xs font-bold text-on-surface-variant">{item.subtitle}</span>
                        </span>
                        <span className="flex-shrink-0 text-right">
                          <span className="block font-mono text-xs font-black text-primary">{item.id}</span>
                          {toPriceInputValue(item.latestPrice) && (
                            <span className="mt-1 block font-mono text-[10px] font-bold text-on-surface-variant">
                              {formatCurrency(item.latestPrice ?? 0)}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-widest text-on-surface-variant">方向</span>
                  <select
                    value={tradeForm.side}
                    onChange={(event) => setTradeForm((form) => ({ ...form, side: event.target.value as TradeSide }))}
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm font-bold text-primary outline-none focus:border-primary"
                  >
                    <option value="buy">买入</option>
                    <option value="sell">卖出</option>
                    <option value="dividend">分红</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-widest text-on-surface-variant">成交时间</span>
                  <input
                    type="date"
                    value={tradeForm.tradedAt}
                    onChange={(event) => setTradeForm((form) => ({ ...form, tradedAt: event.target.value }))}
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm font-bold text-primary outline-none focus:border-primary"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-widest text-on-surface-variant">数量</span>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={tradeForm.quantity}
                    onChange={(event) => setTradeForm((form) => ({ ...form, quantity: event.target.value }))}
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 font-mono text-sm font-bold text-primary outline-none focus:border-primary"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-widest text-on-surface-variant">价格</span>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={tradeForm.price}
                    onChange={(event) => {
                      setIsTradePriceDirty(true);
                      setTradeForm((form) => ({ ...form, price: event.target.value }));
                    }}
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 font-mono text-sm font-bold text-primary outline-none focus:border-primary"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-outline-variant/20 px-6 py-5">
              <button
                type="button"
                onClick={closeTradeDialog}
                className="rounded-xl px-5 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSavingTrade}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-surface hover:opacity-90 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                <Save size={16} />
                {isSavingTrade ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
