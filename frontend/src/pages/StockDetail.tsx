import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, BookmarkPlus, Check, FileSearch, LineChart, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { StockKlineChart } from '@/src/components/StockKlineChart';
import { cn } from '@/src/lib/utils';
import { StockDetailResponse, StockRange, StockRef } from '@/src/types';

interface StockDetailProps {
  stockRef: StockRef | null;
  onSelectStock: (stock: StockRef) => void;
  onViewReports: (stock: StockRef) => void;
}

interface StockSearchResult {
  id: string;
  title: string;
  subtitle?: string | null;
  industry?: string | null;
  latestPrice?: number | null;
  type?: string;
}

interface WatchlistGroup {
  id: string;
  name: string;
}

const RANGE_OPTIONS: Array<{ id: StockRange; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'intraday', label: '1日', icon: LineChart },
  { id: '5d', label: '5日', icon: LineChart },
  { id: 'daily', label: '日 K', icon: BarChart3 },
  { id: 'weekly', label: '周 K', icon: BarChart3 },
  { id: 'monthly', label: '月 K', icon: BarChart3 },
];

const formatPrice = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `¥ ${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatPercent = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const formatMarketCap = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 1_0000_0000_0000) return `${(value / 1_0000_0000_0000).toFixed(2)} 万亿`;
  if (abs >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(2)} 亿`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
};

const formatMetricNumber = (value?: number | null, digits = 2) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
};

const normalizeSearchInput = (value: string) => value.trim();

const hasKnownCategoryValue = (value?: string | null) => {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== '未知' && normalized !== '未分类' && normalized !== '-');
};

const formatIndustry = (value?: string | null) => (
  hasKnownCategoryValue(value) ? value!.trim() : '行业未分类'
);

const formatOwnership = (value?: string | null) => (
  hasKnownCategoryValue(value) ? value!.trim() : '性质未知'
);

const isIndustryUnclassified = (value?: string | null) => !hasKnownCategoryValue(value);
const isOwnershipUnknown = (value?: string | null) => !hasKnownCategoryValue(value);
const OWNERSHIP_OPTIONS = ['央企', '地方国企', '民营企业', '未知'];
type StockRefreshUpdateMode = 'full' | 'price_only';

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDateRangePreset = (preset: '1m' | '3m' | '1y' | 'ytd') => {
  const end = new Date();
  const start = new Date(end);
  if (preset === '1m') start.setMonth(start.getMonth() - 1);
  if (preset === '3m') start.setMonth(start.getMonth() - 3);
  if (preset === '1y') start.setFullYear(start.getFullYear() - 1);
  if (preset === 'ytd') start.setMonth(0, 1);
  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
};

export const StockDetail: React.FC<StockDetailProps> = ({ stockRef, onSelectStock, onViewReports }) => {
  const [range, setRange] = useState<StockRange>('daily');
  const [detail, setDetail] = useState<StockDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);
  const [isWatchlistDialogOpen, setIsWatchlistDialogOpen] = useState(false);
  const [watchlistGroups, setWatchlistGroups] = useState<WatchlistGroup[]>([]);
  const [selectedWatchlistGroupId, setSelectedWatchlistGroupId] = useState('');
  const [isRefreshingDaily, setIsRefreshingDaily] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<StockSearchResult | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isMetadataEditorOpen, setIsMetadataEditorOpen] = useState(false);
  const [metadataDraftIndustry, setMetadataDraftIndustry] = useState('');
  const [metadataDraftOwnership, setMetadataDraftOwnership] = useState('');
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [isRefreshDialogOpen, setIsRefreshDialogOpen] = useState(false);
  const defaultRefreshRange = getDateRangePreset('1y');
  const [refreshUpdateMode, setRefreshUpdateMode] = useState<StockRefreshUpdateMode>('price_only');
  const [refreshStartDate, setRefreshStartDate] = useState(defaultRefreshRange.startDate);
  const [refreshEndDate, setRefreshEndDate] = useState(defaultRefreshRange.endDate);

  useEffect(() => {
    if (!stockRef?.symbol) {
      setDetail(null);
      setIsMetadataEditorOpen(false);
      return;
    }

    let isCurrent = true;

    const loadDetail = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(`/api/v1/stocks/${encodeURIComponent(stockRef.symbol)}/detail?range=${range}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as StockDetailResponse;
        if (isCurrent) {
          setDetail(payload);
        }
      } catch (error) {
        if (isCurrent) {
          setDetail(null);
          setErrorMessage(error instanceof Error ? error.message : '加载个股详情失败');
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      isCurrent = false;
    };
  }, [stockRef, range]);

  const openWatchlistDialog = async () => {
    const symbol = detail?.symbol ?? stockRef?.symbol;
    if (!symbol) return;

    setErrorMessage(null);
    try {
      const response = await fetch('/api/v1/watchlists?group_by=all');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { groups?: WatchlistGroup[] };
      const groups = payload.groups ?? [];
      setWatchlistGroups(groups);
      setSelectedWatchlistGroupId(groups[0]?.id ?? '');
      setIsWatchlistDialogOpen(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加载自选分组失败');
    }
  };

  const addToWatchlist = async () => {
    const symbol = detail?.symbol ?? stockRef?.symbol;
    if (!symbol || !selectedWatchlistGroupId) return;

    setIsAddingWatchlist(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/v1/watchlists/${encodeURIComponent(selectedWatchlistGroupId)}/stocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setIsWatchlistDialogOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加入自选失败');
    } finally {
      setIsAddingWatchlist(false);
    }
  };

  const refreshDailyData = async () => {
    const symbol = detail?.symbol ?? stockRef?.symbol;
    if (!symbol) return;
    if (refreshStartDate && refreshEndDate && refreshStartDate > refreshEndDate) {
      setErrorMessage('日期范围无效：开始日期不能晚于结束日期。');
      return;
    }

    setIsRefreshingDaily(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/v1/stocks/${encodeURIComponent(symbol)}/refresh-daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateMode: refreshUpdateMode,
          startDate: refreshStartDate || undefined,
          endDate: refreshEndDate || undefined,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(payload?.detail || `HTTP ${response.status}`);
      }
      setIsRefreshDialogOpen(false);
      window.dispatchEvent(new CustomEvent('midas:data-sync-updated'));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '刷新个股日报失败');
    } finally {
      setIsRefreshingDaily(false);
    }
  };

  const chartMode = useMemo(() => (
    range === 'daily' || range === 'weekly' || range === 'monthly' ? 'kline' : 'line'
  ), [range]);

  const searchStocks = async () => {
    const query = normalizeSearchInput(searchQuery);
    if (!query) return;

    setIsSearching(true);
    setHasSearched(true);
    setSelectedSearchResult(null);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=8`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { items?: StockSearchResult[] };
      const stocks = (payload.items ?? []).filter((item) => !item.type || item.type === 'stock');
      setSearchResults(stocks);
    } catch (error) {
      setSearchResults([]);
      setErrorMessage(error instanceof Error ? error.message : '搜索股票失败');
    } finally {
      setIsSearching(false);
    }
  };

  const openSearchResult = (result: StockSearchResult) => {
    setSelectedSearchResult(result);
    setSearchQuery(`${result.title} ${result.id}`);
    setSearchResults([]);
    setHasSearched(false);
    setRange('daily');
    onSelectStock({ symbol: result.id, name: result.title });
  };

  const openMetadataEditor = () => {
    setMetadataDraftIndustry(hasKnownCategoryValue(detail?.industry) ? detail!.industry!.trim() : '');
    setMetadataDraftOwnership(hasKnownCategoryValue(detail?.ownership) ? detail!.ownership!.trim() : '');
    setIsMetadataEditorOpen(true);
  };

  const saveMetadata = async () => {
    const symbol = detail?.symbol ?? stockRef?.symbol;
    if (!symbol) return;

    setIsSavingMetadata(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/v1/stocks/${encodeURIComponent(symbol)}/metadata?range=${range}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: metadataDraftIndustry.trim() || undefined,
          ownership: metadataDraftOwnership.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(payload?.detail || `HTTP ${response.status}`);
      }
      const payload = await response.json() as StockDetailResponse;
      setDetail(payload);
      setIsMetadataEditorOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存行业/性质失败');
    } finally {
      setIsSavingMetadata(false);
    }
  };

  const renderSearchBox = (compact = false) => (
    <div className={cn('relative', compact ? 'w-full sm:w-[360px]' : 'w-full md:w-[420px]')}>
      <label className="flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5">
        <Search size={16} className="text-on-surface-variant" />
        <input
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setSelectedSearchResult(null);
            setHasSearched(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void searchStocks();
          }}
          placeholder="搜索股票名称或代码"
          className="w-full bg-transparent text-sm font-bold text-primary outline-none placeholder:text-on-surface-variant/60"
        />
        <button
          type="button"
          onClick={() => void searchStocks()}
          disabled={isSearching || !searchQuery.trim()}
          className="inline-flex h-10 min-w-20 items-center justify-center rounded-xl bg-primary px-5 text-sm font-black text-white disabled:opacity-50"
        >
          搜索
        </button>
      </label>

      {(searchResults.length > 0 || hasSearched) && (
        <div className="absolute left-0 right-0 top-12 z-30 overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl">
          {searchResults.length > 0 ? (
            searchResults.map((result) => (
              <button
                key={result.id}
                type="button"
                onClick={() => openSearchResult(result)}
                className={cn(
                  'w-full border-b border-outline-variant/10 px-4 py-3 text-left transition-colors last:border-b-0',
                  selectedSearchResult?.id === result.id
                    ? 'bg-primary text-white'
                    : 'text-primary hover:bg-surface-container-low'
                )}
              >
                <span className="block truncate text-sm font-black">{result.title}</span>
                <span className={cn(
                  'mt-1 block truncate text-xs font-bold',
                  selectedSearchResult?.id === result.id ? 'text-white/80' : 'text-on-surface-variant'
                )}>
                  {result.id} · {result.industry ?? result.subtitle ?? '未分类'}
                  {typeof result.latestPrice === 'number' ? ` · ${formatPrice(result.latestPrice)}` : ''}
                </span>
              </button>
            ))
          ) : (
            <div className="px-4 py-3 text-sm font-bold text-on-surface-variant">
              {isSearching ? '正在搜索股票...' : '没有搜索到匹配股票'}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!stockRef?.symbol) {
    return (
      <div className="mx-auto max-w-7xl rounded-3xl border border-dashed border-outline-variant/30 bg-surface-container-lowest p-12">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
          <div>
            <h2 className="text-2xl font-[800] font-headline text-primary">个股详情</h2>
            <p className="mt-3 text-sm font-bold text-on-surface-variant">搜索股票，或从“自选股”“投资组合”点击股票代码进入个股页面。</p>
          </div>
          {renderSearchBox()}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="max-w-7xl mx-auto space-y-6">
      <section className="rounded-3xl bg-surface-container-lowest border border-outline-variant/20 p-4">
        <div className="flex justify-end">
          {renderSearchBox(true)}
        </div>
      </section>

      <section className="rounded-3xl bg-surface-container-lowest border border-outline-variant/20 p-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-[800] font-headline text-primary">{detail?.name ?? stockRef.name ?? stockRef.symbol}</h2>
            <p className="mt-1 text-sm font-black text-on-surface-variant">{stockRef.symbol}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-3 py-1 text-on-surface-variant">
                {formatIndustry(detail?.industry)}
                {isIndustryUnclassified(detail?.industry) && (
                  <button
                    type="button"
                    onClick={openMetadataEditor}
                    className="rounded-full p-0.5 text-primary hover:bg-surface-container-highest"
                    aria-label="编辑行业"
                    title="编辑行业"
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-3 py-1 text-on-surface-variant">
                {formatOwnership(detail?.ownership)}
                {isOwnershipUnknown(detail?.ownership) && (
                  <button
                    type="button"
                    onClick={openMetadataEditor}
                    className="rounded-full p-0.5 text-primary hover:bg-surface-container-highest"
                    aria-label="编辑公司性质"
                    title="编辑公司性质"
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </span>
            </div>
            {detail?.mainBusiness && (
              <p className="mt-2 text-xs font-bold text-on-surface-variant">
                主营业务: {detail.mainBusiness}
              </p>
            )}
            {isMetadataEditorOpen && (
              <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-3 sm:flex-row sm:items-end">
                <label className="flex-1 text-xs font-black text-on-surface-variant">
                  行业
                  <input
                    value={metadataDraftIndustry}
                    onChange={(event) => setMetadataDraftIndustry(event.target.value)}
                    placeholder="例如：家用电器"
                    className="mt-1 h-10 w-full rounded-xl border border-outline-variant/20 bg-surface px-3 text-sm font-bold text-primary outline-none focus:border-primary"
                  />
                </label>
                <label className="flex-1 text-xs font-black text-on-surface-variant">
                  公司性质
                  <select
                    value={metadataDraftOwnership}
                    onChange={(event) => setMetadataDraftOwnership(event.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border border-outline-variant/20 bg-surface px-3 text-sm font-bold text-primary outline-none focus:border-primary"
                  >
                    <option value="">请选择</option>
                    {OWNERSHIP_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveMetadata()}
                    disabled={isSavingMetadata || (!metadataDraftIndustry.trim() && !metadataDraftOwnership.trim())}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-black text-white disabled:opacity-50"
                  >
                    <Check size={14} />
                    {isSavingMetadata ? '保存中' : '保存'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMetadataEditorOpen(false)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-surface px-3 text-xs font-black text-on-surface-variant hover:text-primary"
                  >
                    <X size={14} />
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsRefreshDialogOpen(true)}
              disabled={isRefreshingDaily || !(detail?.symbol ?? stockRef.symbol)}
              className="inline-flex items-center gap-2 rounded-xl bg-surface-container-low px-4 py-2.5 text-sm font-black text-primary disabled:opacity-50"
            >
              <RefreshCw size={16} className={cn(isRefreshingDaily && 'animate-spin')} />
              {isRefreshingDaily ? '提交中' : '刷新日报'}
            </button>
            <button
              type="button"
              onClick={() => void openWatchlistDialog()}
              disabled={isAddingWatchlist || !(detail?.symbol ?? stockRef.symbol)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
            >
              <BookmarkPlus size={16} />
              加入自选
            </button>
            <button
              type="button"
              onClick={() => onViewReports({ symbol: detail?.symbol ?? stockRef.symbol, name: detail?.name ?? stockRef.name })}
              className="inline-flex items-center gap-2 rounded-xl bg-surface-container-low px-4 py-2.5 text-sm font-black text-primary"
            >
              <FileSearch size={16} />
              查看研报
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-6 text-sm font-bold">
          <span className={cn('tabular-nums', (detail?.change ?? 0) >= 0 ? 'text-error' : 'text-tertiary-container')}>
            最新价 {formatPrice(detail?.latestPrice)}
          </span>
          <span className={cn('tabular-nums', (detail?.pctChange ?? 0) >= 0 ? 'text-error' : 'text-tertiary-container')}>
            涨跌幅 {formatPercent(detail?.pctChange)}
          </span>
          {isLoading && <RefreshCw size={15} className="animate-spin text-primary" />}
        </div>
      </section>

      {errorMessage && (
        <div className="rounded-xl border border-error/20 bg-error-container/20 px-4 py-3 text-sm font-bold text-error">
          {errorMessage}
        </div>
      )}

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="rounded-3xl bg-surface-container-lowest border border-outline-variant/20 p-5">
          <h3 className="text-xl font-[800] font-headline text-primary">走势线索</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRange(item.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black transition-all',
                    range === item.id
                      ? 'bg-primary text-white'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-primary'
                  )}
                >
                  <Icon size={13} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            {detail?.chart.points?.length ? (
              <StockKlineChart
                points={detail.chart.points}
                mode={chartMode}
                heightClassName="h-[420px]"
                emptyMessage="暂无已同步走势数据"
              />
            ) : (
              <div className="h-[420px] rounded-xl bg-surface-container-low flex items-center justify-center text-sm font-bold text-on-surface-variant">
                暂无已同步走势数据
              </div>
            )}
          </div>
        </div>

        <aside className="rounded-3xl bg-surface-container-lowest border border-outline-variant/20 p-5">
          <h3 className="text-xl font-[800] font-headline text-primary">相关指标</h3>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-surface-container-low px-4 py-3">
              <p className="text-xs font-black text-on-surface-variant">PE</p>
              <p className="mt-1 text-lg font-[800] font-headline text-primary tabular-nums">{formatMetricNumber(detail?.metrics.pe)}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low px-4 py-3">
              <p className="text-xs font-black text-on-surface-variant">PB</p>
              <p className="mt-1 text-lg font-[800] font-headline text-primary tabular-nums">{formatMetricNumber(detail?.metrics.pb)}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low px-4 py-3">
              <p className="text-xs font-black text-on-surface-variant">总市值</p>
              <p className="mt-1 text-lg font-[800] font-headline text-primary tabular-nums">{formatMarketCap(detail?.metrics.marketCap)}</p>
            </div>
            <div className="rounded-xl bg-surface-container-low px-4 py-3">
              <p className="text-xs font-black text-on-surface-variant">股息率</p>
              <p className="mt-1 text-lg font-[800] font-headline text-primary tabular-nums">{formatPercent(detail?.metrics.dividendYield)}</p>
            </div>
          </div>
        </aside>
      </section>
    </div>

    {isWatchlistDialogOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/45 px-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="watchlist-dialog-title" className="w-full max-w-md rounded-3xl bg-surface-container-lowest border border-outline-variant/20 shadow-2xl">
          <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/15">
            <div>
              <p className="text-[10px] font-black text-secondary uppercase tracking-[0.18em]">Watchlist</p>
              <h3 id="watchlist-dialog-title" className="text-xl font-[900] font-headline text-primary mt-1">加入自选分组</h3>
            </div>
            <button
              type="button"
              onClick={() => setIsWatchlistDialogOpen(false)}
              className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors"
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-on-surface-variant">
              将 <span className="font-black text-primary">{detail?.name ?? stockRef?.name ?? stockRef?.symbol} ({detail?.symbol ?? stockRef?.symbol})</span> 加入到：
            </p>

            <select
              value={selectedWatchlistGroupId}
              onChange={(event) => setSelectedWatchlistGroupId(event.target.value)}
              className="w-full rounded-xl border border-outline-variant/25 bg-surface px-4 py-3 text-sm font-bold text-on-surface outline-none focus:border-primary"
            >
              {watchlistGroups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>

            {watchlistGroups.length === 0 && (
              <p className="text-xs font-bold text-error">暂无可用分组，请先在自选页创建分组。</p>
            )}
          </div>

          <div className="px-6 py-5 border-t border-outline-variant/15 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsWatchlistDialogOpen(false)}
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void addToWatchlist()}
              disabled={isAddingWatchlist || !selectedWatchlistGroupId}
              className="px-5 py-2.5 rounded-xl text-sm font-black bg-primary text-surface hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {isAddingWatchlist ? '加入中...' : '确认加入'}
            </button>
          </div>
        </div>
      </div>
    )}

    {isRefreshDialogOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 px-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="refresh-dialog-title" className="w-full max-w-md rounded-3xl bg-surface-container-lowest p-5 shadow-2xl border border-outline-variant/20">
          <div className="mb-5">
            <p className="text-[10px] font-black text-secondary uppercase tracking-[0.18em] mb-1.5">Stock Daily Refresh</p>
            <h2 id="refresh-dialog-title" className="text-2xl font-[900] font-headline text-primary tracking-tight">
              确认更新参数
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.18em] mb-2">日期范围</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="sr-only">开始日期</span>
                  <input
                    type="date"
                    value={refreshStartDate}
                    onChange={(event) => setRefreshStartDate(event.target.value)}
                    className="w-full bg-surface-container-low border-b-2 border-outline/20 focus:border-primary px-3 py-2.5 text-xs font-black text-primary outline-none transition-all rounded-t-2xl tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">结束日期</span>
                  <input
                    type="date"
                    value={refreshEndDate}
                    onChange={(event) => setRefreshEndDate(event.target.value)}
                    className="w-full bg-surface-container-low border-b-2 border-outline/20 focus:border-primary px-3 py-2.5 text-xs font-black text-primary outline-none transition-all rounded-t-2xl tabular-nums"
                  />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[
                  { id: '1m' as const, label: '近1月' },
                  { id: '3m' as const, label: '近3月' },
                  { id: '1y' as const, label: '近1年' },
                  { id: 'ytd' as const, label: '今年' },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      const rangePreset = getDateRangePreset(preset.id);
                      setRefreshStartDate(rangePreset.startDate);
                      setRefreshEndDate(rangePreset.endDate);
                    }}
                    className="rounded-xl border border-outline-variant/20 px-2 py-1.5 text-[10px] font-black text-primary transition-colors hover:bg-surface-container-low"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.18em] mb-2">更新方式</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'full' as const, label: '全量更新', description: '补齐所选日期区间内日线数据' },
                  { id: 'price_only' as const, label: '仅更新现价', description: '更新最新现价并刷新价格信号' },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => setRefreshUpdateMode(option.id)}
                    className={cn(
                      'rounded-2xl border p-3 text-left transition-all',
                      refreshUpdateMode === option.id
                        ? 'border-primary bg-tertiary-fixed/40 text-primary'
                        : 'border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:border-primary/40'
                    )}
                  >
                    <span className="block font-headline font-[900] text-sm">{option.label}</span>
                    <span className="block text-[10px] font-bold mt-1 leading-snug">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsRefreshDialogOpen(false)}
              className="px-4 py-2.5 rounded-2xl font-[800] text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void refreshDailyData()}
              disabled={isRefreshingDaily}
              className="px-6 py-2.5 rounded-2xl font-[900] font-headline text-sm bg-primary text-surface shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {isRefreshingDaily ? '提交中' : '确认'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};
