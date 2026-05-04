import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Plus,
  RotateCcw,
  Play,
  Download,
  Columns,
  Filter,
  TrendingUp,
  TrendingDown,
  X,
  ChevronDown,
  ChevronUp,
  LineChart,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { StockRef } from '@/src/types';

type TradeSignal = 'buy' | 'sell' | 'hold';

interface ScreeningResult {
  symbol: string;
  name: string;
  exchange?: string;
  listingExchange?: string;
  ownership?: string;
  tradeDate?: string;
  industry: string;
  price: number;
  change: number;
  marketCap: string;
  pe: number;
  dividend: number;
  revenueSegments?: Array<{
    name: string;
    revenuePercent: number;
  }>;
  initial: string;
  ma120: number;
  ma120Lower: number;
  ma120Upper: number;
  signal: TradeSignal;
}

type NumericFilterKey = 'pe' | 'dividend' | 'marketCap';
type SortField = 'price' | 'signal' | 'marketCap' | 'pe' | 'dividend';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

interface NumericFilterState {
  key: NumericFilterKey;
  label: string;
  operator: 'lt' | 'gt';
  value: string;
  enabled: boolean;
}

interface AppliedScreenerQuery {
  numericFilters: NumericFilterState[];
  ownership: string[];
  exchanges: string[];
  signals: TradeSignal[];
  sort: SortConfig;
}

interface ScreenerResponse {
  items: ScreeningResult[];
  page: number;
  pageSize: number;
  total: number;
  availableTotal?: number;
}

interface ScreenerOptionsResponse {
  numericFilters: Array<{
    key: NumericFilterKey;
    label: string;
    operator: 'lt' | 'gt';
    defaultValue: number;
  }>;
  ownership: string[];
  exchanges: string[];
}

interface WatchlistGroup {
  id: string;
  name: string;
  groupType?: string;
}

interface ScreenerProps {
  onOpenStockDetail: (stock: StockRef) => void;
}

const PAGE_SIZE = 20;
const REQUIRED_OWNERSHIP_OPTIONS = ['央企', '地方国企', '民营企业'];
const REQUIRED_EXCHANGE_OPTIONS = ['沪深', '北交所', '创业板'];
const SIGNAL_OPTIONS: TradeSignal[] = ['buy', 'sell', 'hold'];

const mergeOptions = (requiredOptions: string[], apiOptions?: string[]) => (
  Array.from(new Set([...requiredOptions, ...(apiOptions ?? [])].filter(Boolean)))
);

const createDefaultNumericFilters = (options?: ScreenerOptionsResponse['numericFilters']): NumericFilterState[] => {
  if (!options || options.length === 0) {
    return [];
  }
  return options.map((option) => ({
    key: option.key,
    label: option.label,
    operator: option.operator,
    value: String(option.defaultValue),
    enabled: false,
  }));
};

const getSignalLabel = (signal: TradeSignal) => {
  if (signal === 'buy') return '买入';
  if (signal === 'sell') return '卖出';
  return '观望';
};

const getOwnershipBadgeLabel = (ownership?: string) => {
  if (!ownership) return '-';
  if (ownership.includes('央企')) return '央';
  if (ownership.includes('地方国企')) return '国';
  if (ownership.includes('民企') || ownership.includes('民营')) return '民';
  return '-';
};

const formatPe = (pe: number) => (
  Number(pe ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
);

const formatRevenueSegments = (segments?: ScreeningResult['revenueSegments']) => {
  if (!segments || segments.length === 0) return '-';
  return segments
    .map((segment) => `${segment.name} ${Number(segment.revenuePercent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`)
    .join(' / ');
};

const mergeResultsBySymbol = (existing: ScreeningResult[], incoming: ScreeningResult[]) => {
  const seen = new Set(existing.map((item) => item.symbol));
  return [...existing, ...incoming.filter((item) => !seen.has(item.symbol))];
};

const cloneNumericFilters = (filters: NumericFilterState[]) => filters.map((filter) => ({ ...filter }));

export const Screener: React.FC<ScreenerProps> = ({ onOpenStockDetail }) => {
  const [activeExchanges, setActiveExchanges] = useState<string[]>([]);
  const [activeOwnership, setActiveOwnership] = useState<string[]>([]);
  const [activeSignals, setActiveSignals] = useState<TradeSignal[]>(SIGNAL_OPTIONS);
  const [ownershipOptions, setOwnershipOptions] = useState<string[]>([]);
  const [exchangeOptions, setExchangeOptions] = useState<string[]>([]);
  const [baseNumericFilters, setBaseNumericFilters] = useState<NumericFilterState[]>([]);
  const [numericFilters, setNumericFilters] = useState<NumericFilterState[]>([]);
  const [results, setResults] = useState<ScreeningResult[]>([]);
  const [total, setTotal] = useState(0);
  const [availableTotal, setAvailableTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'marketCap', direction: 'desc' });
  const [watchlistGroups, setWatchlistGroups] = useState<WatchlistGroup[]>([]);
  const [isWatchlistDialogOpen, setIsWatchlistDialogOpen] = useState(false);
  const [selectedStockForWatchlist, setSelectedStockForWatchlist] = useState<ScreeningResult | null>(null);
  const [selectedWatchlistGroupId, setSelectedWatchlistGroupId] = useState('');
  const [isSavingWatchlist, setIsSavingWatchlist] = useState(false);
  const [expandedStocks, setExpandedStocks] = useState<Set<string>>(new Set());
  const [appliedQuery, setAppliedQuery] = useState<AppliedScreenerQuery>({
    numericFilters: [],
    ownership: [],
    exchanges: [],
    signals: SIGNAL_OPTIONS,
    sort: { field: 'marketCap', direction: 'desc' },
  });
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const toggleFilter = <T extends string>(
    list: T[],
    setList: React.Dispatch<React.SetStateAction<T[]>>,
    item: T
  ) => {
    if (list.includes(item)) {
      setList(list.filter((i) => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  const toggleNumericFilter = (key: NumericFilterKey) => {
    setNumericFilters((filters) =>
      filters.map((filter) =>
        filter.key === key ? { ...filter, enabled: !filter.enabled } : filter
      )
    );
  };

  const updateNumericFilterValue = (key: NumericFilterKey, value: string) => {
    setNumericFilters((filters) =>
      filters.map((filter) =>
        filter.key === key ? { ...filter, value } : filter
      )
    );
  };

  const buildFilterPayload = (
    targetPage: number,
    numericSource = numericFilters,
    ownershipSource = activeOwnership,
    exchangeSource = activeExchanges,
    signalSource = activeSignals,
    sortSource = sortConfig
  ) => {
    const filters = numericSource.reduce<Record<string, { operator: 'lt' | 'gt'; value: number }>>((acc, filter) => {
      const value = Number(filter.value);
      if (filter.enabled && Number.isFinite(value)) {
        acc[filter.key] = { operator: filter.operator, value };
      }
      return acc;
    }, {});

    return {
      filters,
      ownership: ownershipSource,
      exchanges: exchangeSource,
      signals: signalSource,
      page: targetPage,
      pageSize: PAGE_SIZE,
      sort: sortSource,
    };
  };

  const fetchScreenerResults = async (
    targetPage = page,
    numericSource = numericFilters,
    ownershipSource = activeOwnership,
    exchangeSource = activeExchanges,
    signalSource = activeSignals,
    mode: 'replace' | 'append' = 'replace',
    sortSource = sortConfig
  ) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/v1/screener/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFilterPayload(targetPage, numericSource, ownershipSource, exchangeSource, signalSource, sortSource)),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json() as ScreenerResponse;
      setResults((currentResults) => (
        mode === 'append'
          ? mergeResultsBySymbol(currentResults, payload.items ?? [])
          : payload.items ?? []
      ));
      setTotal(payload.total ?? 0);
      setAvailableTotal(payload.availableTotal ?? 0);
      setPage(payload.page ?? targetPage);
      if (mode === 'replace') {
        setAppliedQuery({
          numericFilters: cloneNumericFilters(numericSource),
          ownership: [...ownershipSource],
          exchanges: [...exchangeSource],
          signals: [...signalSource],
          sort: sortSource,
        });
        setExpandedStocks(new Set());
      }
    } catch (error) {
      if (mode === 'replace') {
        setResults([]);
        setTotal(0);
        setAvailableTotal(0);
      }
      setPage(targetPage);
      setErrorMessage(error instanceof Error ? error.message : '未知错误');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadOptionsAndResults = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const optionsResponse = await fetch('/api/v1/screener/options');
        if (!optionsResponse.ok) {
          throw new Error(`HTTP ${optionsResponse.status}`);
        }

        const options = await optionsResponse.json() as ScreenerOptionsResponse;
        const initialNumericFilters = createDefaultNumericFilters(options.numericFilters);
        const initialOwnershipOptions = mergeOptions(REQUIRED_OWNERSHIP_OPTIONS, options.ownership);
        const initialExchangeOptions = mergeOptions(REQUIRED_EXCHANGE_OPTIONS, options.exchanges);

        if (!isMounted) return;

        setBaseNumericFilters(initialNumericFilters);
        setNumericFilters(initialNumericFilters);
        setOwnershipOptions(initialOwnershipOptions);
        setExchangeOptions(initialExchangeOptions);
        setActiveOwnership(initialOwnershipOptions);
        setActiveExchanges(initialExchangeOptions);

        await fetchScreenerResults(1, initialNumericFilters, initialOwnershipOptions, initialExchangeOptions);
      } catch (error) {
        if (!isMounted) return;
        setResults([]);
        setTotal(0);
        setAvailableTotal(0);
        setErrorMessage(error instanceof Error ? error.message : '未知错误');
        setIsLoading(false);
      }
    };

    void loadOptionsAndResults();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleRunScreener = () => {
    void fetchScreenerResults(1, numericFilters, activeOwnership, activeExchanges, activeSignals);
  };

  const handleClearFilters = () => {
    const resetFilters = baseNumericFilters.map((filter) => ({ ...filter }));
    setNumericFilters(resetFilters);
    setActiveOwnership(ownershipOptions);
    setActiveExchanges(exchangeOptions);
    setActiveSignals(SIGNAL_OPTIONS);
    void fetchScreenerResults(1, resetFilters, ownershipOptions, exchangeOptions, SIGNAL_OPTIONS);
  };

  const handleSortChange = (field: SortField) => {
    const nextSort: SortConfig = {
      field,
      direction: sortConfig.field === field && sortConfig.direction === 'desc' ? 'asc' : 'desc',
    };
    setSortConfig(nextSort);
    void fetchScreenerResults(
      1,
      appliedQuery.numericFilters,
      appliedQuery.ownership,
      appliedQuery.exchanges,
      appliedQuery.signals,
      'replace',
      nextSort
    );
  };

  const handleLoadMore = () => {
    if (isLoading || results.length >= total) return;
    void fetchScreenerResults(
      page + 1,
      appliedQuery.numericFilters,
      appliedQuery.ownership,
      appliedQuery.exchanges,
      appliedQuery.signals,
      'append',
      appliedQuery.sort
    );
  };

  const toggleStockDetails = (symbol: string) => {
    setExpandedStocks((current) => {
      const next = new Set(current);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const openWatchlistDialog = async (stock: ScreeningResult) => {
    setSelectedStockForWatchlist(stock);
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
      setErrorMessage(error instanceof Error ? `加载自选分组失败: ${error.message}` : '加载自选分组失败');
    }
  };

  const closeWatchlistDialog = () => {
    setIsWatchlistDialogOpen(false);
    setSelectedStockForWatchlist(null);
    setSelectedWatchlistGroupId('');
  };

  const handleConfirmAddToWatchlist = async () => {
    if (!selectedStockForWatchlist || !selectedWatchlistGroupId) return;

    setIsSavingWatchlist(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/watchlists/${encodeURIComponent(selectedWatchlistGroupId)}/stocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedStockForWatchlist.symbol }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      closeWatchlistDialog();
    } catch (error) {
      setErrorMessage(error instanceof Error ? `加入自选失败: ${error.message}` : '加入自选失败');
    } finally {
      setIsSavingWatchlist(false);
    }
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    params.set('filters', JSON.stringify(buildFilterPayload(
      1,
      appliedQuery.numericFilters,
      appliedQuery.ownership,
      appliedQuery.exchanges,
      appliedQuery.signals,
      appliedQuery.sort
    ).filters));
    appliedQuery.ownership.forEach((item) => params.append('ownership', item));
    appliedQuery.exchanges.forEach((item) => params.append('exchanges', item));
    appliedQuery.signals.forEach((item) => params.append('signals', item));
    window.location.assign(`/api/v1/screener/export?${params.toString()}`);
  };

  const enabledNumericFilters = numericFilters.filter((filter) => {
    const value = Number(filter.value);
    return filter.enabled && Number.isFinite(value);
  });
  const hasOwnershipFilter = activeOwnership.length !== ownershipOptions.length;
  const hasExchangeFilter = activeExchanges.length !== exchangeOptions.length;
  const hasSignalFilter = activeSignals.length !== SIGNAL_OPTIONS.length;
  const hasActiveFilters = enabledNumericFilters.length > 0 || hasOwnershipFilter || hasExchangeFilter || hasSignalFilter;
  const displayedResults = results;
  const loadedCount = results.length;
  const hasMoreResults = results.length < total;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreResults || isLoading || errorMessage) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        handleLoadMore();
      }
    }, { rootMargin: '240px' });

    observer.observe(target);

    return () => observer.disconnect();
  }, [hasMoreResults, isLoading, errorMessage, page, results.length, appliedQuery]);

  const renderSortableHeader = (field: SortField, label: string, align: 'right' | 'center' = 'right') => {
    const isActive = sortConfig.field === field;
    const SortIcon = !isActive ? ArrowUpDown : sortConfig.direction === 'asc' ? ArrowUp : ArrowDown;
    const directionLabel = sortConfig.direction === 'asc' ? '正序' : '倒序';

    return (
      <button
        type="button"
        onClick={() => handleSortChange(field)}
        title={`按${label}${isActive ? directionLabel : '排序'}`}
        className={cn(
          "inline-flex items-center gap-1.5 font-black transition-colors hover:text-primary",
          align === 'right' ? "w-full justify-end" : "justify-center"
        )}
      >
        <span>{label}</span>
        <SortIcon size={13} className={cn("shrink-0", isActive && "text-primary")} />
      </button>
    );
  };

  const renderMobileCards = () => (
    <div data-testid="screener-mobile-cards" className="md:hidden divide-y divide-surface-container-low/60">
      {displayedResults.map((stock) => {
        const isExpanded = expandedStocks.has(stock.symbol);

        return (
          <article key={stock.symbol} className="p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="w-24 truncate whitespace-nowrap text-base font-bold text-primary" title={stock.name}>{stock.name}</p>
                <p className="text-[11px] font-mono text-on-surface-variant/70 tracking-wider">{stock.symbol}</p>
                <p className="text-xs text-on-surface-variant mt-1">{stock.industry || '-'}</p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center justify-center gap-1 min-w-14 px-2.5 py-1 rounded-md text-[11px] font-black",
                  stock.signal === 'buy' && "bg-error-container/40 text-error",
                  stock.signal === 'sell' && "bg-tertiary-container/10 text-tertiary-container",
                  stock.signal === 'hold' && "bg-surface-container-highest text-on-surface-variant"
                )}
              >
                {getSignalLabel(stock.signal)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <p><span className="text-on-surface-variant">收盘价</span> <span className="font-bold">{stock.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
              <p><span className="text-on-surface-variant">涨跌幅</span> <span className="font-bold">{stock.change >= 0 ? '+' : ''}{stock.change}%</span></p>
              <p><span className="text-on-surface-variant">市值</span> <span className="font-bold">{stock.marketCap}</span></p>
              <p><span className="text-on-surface-variant">市盈率</span> <span className="font-bold">{formatPe(stock.pe)}</span></p>
              <p><span className="text-on-surface-variant">股息率</span> <span className="font-bold">{Number(stock.dividend ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span></p>
              <p><span className="text-on-surface-variant">MA120 信号</span> <span className="font-bold">{getSignalLabel(stock.signal)}</span></p>
            </div>

            {isExpanded && (
              <div className="space-y-1.5 overflow-hidden rounded-xl bg-surface-container-low/50 p-2.5 text-xs">
                <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
                  <p><span className="text-on-surface-variant">最近交易日</span> <span className="font-bold">{stock.tradeDate || '-'}</span></p>
                  <p><span className="text-on-surface-variant">板块</span> <span className="font-bold">{stock.exchange || stock.listingExchange || '-'}</span></p>
                  <p><span className="text-on-surface-variant">公司性质</span> <span className="font-bold">{stock.ownership || '-'}</span></p>
                  <button
                    type="button"
                    onClick={() => onOpenStockDetail({ symbol: stock.symbol, name: stock.name })}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-black text-surface transition-colors hover:opacity-90"
                  >
                    <LineChart size={14} />
                    K线
                  </button>
                </div>
                <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
                  <p><span className="text-on-surface-variant">MA120</span> <span className="font-bold">{stock.ma120.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
                  <p><span className="text-on-surface-variant">0.88</span> <span className="font-bold">{stock.ma120Lower.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
                  <p><span className="text-on-surface-variant">1.12</span> <span className="font-bold">{stock.ma120Upper.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
                  <p className="min-w-0 truncate" title={formatRevenueSegments(stock.revenueSegments)}>
                    <span className="text-on-surface-variant">前三营收</span> <span className="font-bold">{formatRevenueSegments(stock.revenueSegments)}</span>
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void openWatchlistDialog(stock)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black bg-surface-container text-primary hover:bg-surface-container-highest transition-colors"
              >
                <Plus size={14} />
                自选
              </button>
              <button
                type="button"
                onClick={() => toggleStockDetails(stock.symbol)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                aria-expanded={isExpanded}
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {isExpanded ? '收起详情' : '查看详情'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );

  return (
    <div className="w-full px-2 sm:px-3 lg:px-4 xl:px-5 space-y-3 md:space-y-4 lg:space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-3">
        <div>
          <h1 className="text-4xl font-extrabold font-headline text-primary tracking-tight">高级选股器</h1>
          <p className="text-on-surface-variant mt-2 font-medium">通过精准过滤发现高潜力中国 A 股标的。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClearFilters}
            data-feedback="筛选条件已清空"
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface-variant font-bold text-sm hover:bg-surface-container-low transition-colors"
          >
            <RotateCcw size={16} />
            一键清除
          </button>
          <button
            type="button"
            onClick={handleRunScreener}
            disabled={isLoading}
            data-feedback="正在运行真实数据筛选"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-surface font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
          >
            <Play size={16} fill="currentColor" />
            {isLoading ? '筛选中' : '运行筛选'}
          </button>
        </div>
      </div>

      {/* Compact Filters */}
      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-2 shadow-sm">
        <div className="space-y-1.5">
          <div className="flex flex-col gap-1.5 rounded-xl border border-tertiary/15 bg-tertiary/5 px-2.5 py-1.5 lg:flex-row lg:items-center">
            <div className="flex min-w-20 items-center gap-1.5 text-xs font-black text-tertiary">
              <Filter size={15} />
              数值
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {numericFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.key}
                  onClick={() => toggleNumericFilter(filter.key)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-lg border bg-surface px-2 text-xs transition-colors",
                    filter.enabled ? "border-tertiary/40 text-tertiary shadow-sm" : "border-outline-variant/20 bg-surface/60 text-on-surface-variant hover:bg-surface"
                  )}
                  aria-pressed={filter.enabled}
                >
                  <span className="font-black whitespace-nowrap">{filter.label}</span>
                  <span className="font-bold text-on-surface-variant/70">{filter.operator === 'lt' ? '<' : '>'}</span>
                  <input
                    type="text"
                    value={filter.value}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateNumericFilterValue(filter.key, event.target.value)}
                    className="h-6 w-16 rounded-md bg-surface-container-low px-2 text-right font-black text-on-surface outline-none focus:ring-1 focus:ring-primary"
                  />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setNumericFilters((filters) => filters.map((filter) => ({ ...filter, enabled: true })))}
                className="h-8 px-2 text-xs font-black text-primary hover:underline"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setNumericFilters((filters) => filters.map((filter) => ({ ...filter, enabled: false })))}
                className="h-8 border-l border-outline-variant/25 pl-3 pr-1 text-xs font-black text-on-surface-variant hover:text-primary"
              >
                清除
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl border border-tertiary/15 bg-tertiary/5 px-2.5 py-1.5 lg:flex-row lg:items-center">
            <div className="flex min-w-20 items-center gap-1.5 text-xs font-black text-tertiary">
              <Plus size={15} />
              公司性质
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {ownershipOptions.map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => toggleFilter(activeOwnership, setActiveOwnership, option)}
                  className={cn(
                    "h-8 rounded-lg border px-2.5 text-xs font-black transition-all",
                    activeOwnership.includes(option)
                      ? "border-tertiary/40 bg-surface text-tertiary shadow-sm"
                      : "border-outline-variant/20 bg-surface/60 text-on-surface-variant hover:bg-surface"
                  )}
                >
                  {option}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setActiveOwnership(ownershipOptions)}
                className="h-8 px-2 text-xs font-black text-primary hover:underline"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setActiveOwnership([])}
                className="h-8 border-l border-outline-variant/25 pl-3 pr-1 text-xs font-black text-on-surface-variant hover:text-primary"
              >
                清除
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl border border-tertiary/15 bg-tertiary/5 px-2.5 py-1.5 lg:flex-row lg:items-center">
            <div className="flex min-w-20 items-center gap-1.5 text-xs font-black text-tertiary">
              <Columns size={15} />
              板块
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {exchangeOptions.map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => toggleFilter(activeExchanges, setActiveExchanges, option)}
                  className={cn(
                    "h-8 rounded-lg border px-2.5 text-xs font-black transition-all",
                    activeExchanges.includes(option)
                      ? "border-tertiary/40 bg-surface text-tertiary shadow-sm"
                      : "border-outline-variant/20 bg-surface/60 text-on-surface-variant hover:bg-surface"
                  )}
                >
                  {option}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setActiveExchanges(exchangeOptions)}
                className="h-8 px-2 text-xs font-black text-primary hover:underline"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setActiveExchanges([])}
                className="h-8 border-l border-outline-variant/25 pl-3 pr-1 text-xs font-black text-on-surface-variant hover:text-primary"
              >
                清除
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl border border-tertiary/15 bg-tertiary/5 px-2.5 py-1.5 lg:flex-row lg:items-center">
            <div className="flex min-w-20 items-center gap-1.5 text-xs font-black text-tertiary">
              <ArrowUpDown size={15} />
              信号
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {SIGNAL_OPTIONS.map((signal) => (
                <button
                  type="button"
                  key={signal}
                  onClick={() => toggleFilter(activeSignals, setActiveSignals, signal)}
                  className={cn(
                    "h-8 rounded-lg border px-2.5 text-xs font-black transition-all",
                    activeSignals.includes(signal)
                      ? "border-tertiary/40 bg-surface text-tertiary shadow-sm"
                      : "border-outline-variant/20 bg-surface/60 text-on-surface-variant hover:bg-surface"
                  )}
                >
                  {getSignalLabel(signal)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setActiveSignals(SIGNAL_OPTIONS)}
                className="h-8 px-2 text-xs font-black text-primary hover:underline"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setActiveSignals([])}
                className="h-8 border-l border-outline-variant/25 pl-3 pr-1 text-xs font-black text-on-surface-variant hover:text-primary"
              >
                清除
              </button>
              <span className="ml-auto hidden text-xs font-bold text-on-surface-variant/70 sm:inline">
                生效条件 {enabledNumericFilters.length + (hasOwnershipFilter ? 1 : 0) + (hasExchangeFilter ? 1 : 0) + (hasSignalFilter ? 1 : 0)} 项
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-container flex justify-between items-center bg-surface-bright/50 backdrop-blur-sm">
          <h3 className="text-lg font-bold font-headline text-primary flex items-center gap-2">
            筛选结果
            <span className="text-sm font-medium text-on-surface-variant bg-surface-container px-3 py-1 rounded-full">
              {isLoading ? '加载中' : `${total} 标的命中`}
            </span>
          </h3>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="下载筛选结果"
              onClick={handleExport}
              data-feedback="正在导出当前选股结果"
              className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all rounded-lg"
            >
              <Download size={20} />
            </button>
          </div>
        </div>

        {isLoading && results.length === 0 && (
          <div className="md:hidden px-4 py-10 text-center text-sm font-bold text-on-surface-variant">
            正在加载真实选股数据...
          </div>
        )}

        {!isLoading && errorMessage && (
          <div className="md:hidden px-4 py-10 text-center text-sm font-bold text-error">
            无法加载选股器数据: {errorMessage}
          </div>
        )}

        {!isLoading && !errorMessage && displayedResults.length === 0 && (
          <div className="md:hidden px-4 py-10 text-center text-sm font-bold text-on-surface-variant">
            {availableTotal === 0
              ? '暂无真实选股数据，请先到设置页点击“更新选股器数据”。'
              : '当前筛选条件下无结果，请放宽条件或点击“一键清除”。'}
            {availableTotal > 0 && hasActiveFilters && (
              <div className="mt-3 text-xs font-medium text-on-surface-variant/80">
                生效条件：数值筛选 {enabledNumericFilters.length} 项，公司性质 {activeOwnership.length}/{ownershipOptions.length} 项，上市板块 {activeExchanges.length}/{exchangeOptions.length} 项，信号 {activeSignals.length}/{SIGNAL_OPTIONS.length} 项
              </div>
            )}
          </div>
        )}

        {!isLoading && !errorMessage && displayedResults.length > 0 && renderMobileCards()}

        <div data-testid="screener-desktop-table" className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[760px] text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50 text-[10px] font-black text-on-surface-variant uppercase tracking-[0.15em]">
                <th className="px-2 md:px-3 py-2 font-black whitespace-nowrap">名称/代码/行业</th>
                <th className="px-2 md:px-3 py-2 font-black text-right whitespace-nowrap" aria-sort={sortConfig.field === 'price' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('price', '收盘价 (¥)')}
                </th>
                <th className="px-2 md:px-3 py-2 font-black text-right whitespace-nowrap">涨跌幅</th>
                <th className="px-2 md:px-3 py-2 font-black text-center whitespace-nowrap" aria-sort={sortConfig.field === 'signal' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('signal', 'MA120 信号', 'center')}
                </th>
                <th className="px-2 md:px-3 py-2 font-black text-right whitespace-nowrap" aria-sort={sortConfig.field === 'marketCap' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('marketCap', '市值 (亿 RMB)')}
                </th>
                <th className="px-2 md:px-3 py-2 font-black text-right whitespace-nowrap" aria-sort={sortConfig.field === 'pe' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('pe', '市盈率 (TTM)')}
                </th>
                <th className="px-2 md:px-3 py-2 font-black text-right whitespace-nowrap" aria-sort={sortConfig.field === 'dividend' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('dividend', '股息率 (%)')}
                </th>
                <th className="px-2 md:px-3 py-2 font-black text-center whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y-0">
              {isLoading && results.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm font-bold text-on-surface-variant">
                    正在加载真实选股数据...
                  </td>
                </tr>
              )}
              {!isLoading && errorMessage && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm font-bold text-error">
                    无法加载选股器数据: {errorMessage}
                  </td>
                </tr>
              )}
              {!isLoading && !errorMessage && displayedResults.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm font-bold text-on-surface-variant">
                    {availableTotal === 0
                      ? '暂无真实选股数据，请先到设置页点击“更新选股器数据”。'
                      : '当前筛选条件下无结果，请放宽条件或点击“一键清除”。'}
                    {availableTotal > 0 && hasActiveFilters && (
                      <div className="mt-3 text-xs font-medium text-on-surface-variant/80">
                        生效条件：数值筛选 {enabledNumericFilters.length} 项，公司性质 {activeOwnership.length}/{ownershipOptions.length} 项，上市板块 {activeExchanges.length}/{exchangeOptions.length} 项，信号 {activeSignals.length}/{SIGNAL_OPTIONS.length} 项
                      </div>
                    )}
                  </td>
                </tr>
              )}
              {displayedResults.map((stock) => {
                const isExpanded = expandedStocks.has(stock.symbol);

                return (
                  <React.Fragment key={stock.symbol}>
                    <tr className={cn(
                      "group transition-colors border-b border-surface-container-low/30",
                      "hover:bg-surface-container-low/50",
                      isExpanded && "bg-surface-container-low/30"
                    )}>
                      <td className="px-2 md:px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={cn(
                            "w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs transition-transform group-hover:scale-110 duration-300",
                            activeExchanges.includes('沪深') ? "bg-primary/5 text-primary" : "bg-secondary/10 text-secondary"
                          )} title={stock.ownership || '公司性质未知'}>
                            {getOwnershipBadgeLabel(stock.ownership)}
                          </div>
                          <div>
                            <div className="w-24 truncate whitespace-nowrap font-bold text-primary text-base group-hover:text-primary-container transition-colors" title={stock.name}>
                              {stock.name}
                            </div>
                            <div className="text-[10px] font-bold text-on-surface-variant/70 font-mono tracking-wider">
                              {stock.symbol}
                            </div>
                            <div className="text-xs font-medium text-on-surface-variant mt-1">
                              {stock.industry || '-'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 md:px-3 py-3 text-right font-bold text-on-surface tabular-nums">
                        {stock.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 md:px-3 py-3 text-right">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-black shadow-sm",
                          stock.change >= 0
                            ? "bg-error-container/40 text-error"
                            : "bg-tertiary-container/10 text-tertiary-container"
                        )}>
                          {stock.change >= 0 ? <TrendingUp size={14} className="stroke-[3px]" /> : <TrendingDown size={14} className="stroke-[3px]" />}
                          {stock.change >= 0 ? '+' : ''}{stock.change}%
                        </span>
                      </td>
                      <td className="px-2 md:px-3 py-3 text-center">
                        <span className={cn(
                          "inline-flex items-center justify-center gap-1 min-w-14 px-2 py-1 rounded-lg text-xs font-black shadow-sm",
                          stock.signal === 'buy' && "bg-error-container/40 text-error",
                          stock.signal === 'sell' && "bg-tertiary-container/10 text-tertiary-container",
                          stock.signal === 'hold' && "bg-surface-container-highest text-on-surface-variant"
                        )}>
                          {stock.signal === 'buy' && <TrendingUp size={14} className="stroke-[3px]" />}
                          {stock.signal === 'sell' && <TrendingDown size={14} className="stroke-[3px]" />}
                          {getSignalLabel(stock.signal)}
                        </span>
                      </td>
                      <td className="px-2 md:px-3 py-3 text-right font-medium text-on-surface-variant font-mono text-xs">
                        {stock.marketCap}
                      </td>
                      <td className="px-2 md:px-3 py-3 text-right font-medium text-on-surface-variant font-mono text-xs">
                        {formatPe(stock.pe)}
                      </td>
                      <td className="px-2 md:px-3 py-3 text-right font-medium text-on-surface-variant font-mono text-xs">
                        {Number(stock.dividend ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 md:px-3 py-3 text-center">
                        <div className="inline-flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void openWatchlistDialog(stock)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-black bg-surface-container text-primary hover:bg-surface-container-highest transition-colors"
                          >
                            <Plus size={14} />
                            自选
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleStockDetails(stock.symbol)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-black text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            {isExpanded ? '收起' : '详情'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b-2 border-surface-container-low/40 bg-surface-container-low/20">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="space-y-2 text-xs text-on-surface-variant">
                            <div className="flex items-center gap-5 whitespace-nowrap">
                              <p><span className="font-black text-on-surface">最近交易日：</span>{stock.tradeDate || '-'}</p>
                              <p><span className="font-black text-on-surface">板块：</span>{stock.exchange || stock.listingExchange || '-'}</p>
                              <p><span className="font-black text-on-surface">公司性质：</span>{stock.ownership || '-'}</p>
                              <button
                                type="button"
                                onClick={() => onOpenStockDetail({ symbol: stock.symbol, name: stock.name })}
                                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-black text-surface transition-colors hover:opacity-90"
                              >
                                <LineChart size={14} />
                                K线
                              </button>
                            </div>
                            <div className="flex min-w-0 items-center gap-5 whitespace-nowrap">
                              <p><span className="font-black text-on-surface">MA120：</span>{stock.ma120.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                              <p><span className="font-black text-on-surface">MA120×0.88：</span>{stock.ma120Lower.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                              <p><span className="font-black text-on-surface">MA120×1.12：</span>{stock.ma120Upper.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                              <p className="min-w-0 truncate" title={formatRevenueSegments(stock.revenueSegments)}>
                                <span className="font-black text-on-surface">前三营收业务：</span>{formatRevenueSegments(stock.revenueSegments)}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div
          ref={loadMoreRef}
          className="px-3 py-3 bg-surface-bright/50 border-t border-surface-container flex flex-col sm:flex-row items-center justify-between gap-2"
        >
          <span className="text-xs font-bold text-on-surface-variant/70">
            已加载 {Math.min(loadedCount, total)} / {total} 条结果
          </span>
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={!hasMoreResults || isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black text-primary bg-surface-container hover:bg-surface-container-highest transition-all disabled:opacity-40 disabled:hover:bg-surface-container"
          >
            <ArrowDown size={16} />
            {isLoading && loadedCount > 0 ? '正在加载更多' : hasMoreResults ? '加载更多' : '已加载全部'}
          </button>
        </div>
      </div>
      {isWatchlistDialogOpen && selectedStockForWatchlist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/45 px-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="watchlist-dialog-title" className="w-full max-w-md rounded-3xl bg-surface-container-lowest border border-outline-variant/20 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/15">
              <div>
                <p className="text-[10px] font-black text-secondary uppercase tracking-[0.18em]">Watchlist</p>
                <h3 id="watchlist-dialog-title" className="text-xl font-[900] font-headline text-primary mt-1">加入自选分组</h3>
              </div>
              <button
                type="button"
                onClick={closeWatchlistDialog}
                className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-on-surface-variant">
                将 <span className="font-black text-primary">{selectedStockForWatchlist.name} ({selectedStockForWatchlist.symbol})</span> 加入到：
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
                onClick={closeWatchlistDialog}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmAddToWatchlist()}
                disabled={isSavingWatchlist || !selectedWatchlistGroupId}
                className="px-5 py-2.5 rounded-xl text-sm font-black bg-primary text-surface hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {isSavingWatchlist ? '加入中...' : '确认加入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
