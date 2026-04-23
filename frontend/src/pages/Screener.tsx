import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Check,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

type TradeSignal = 'buy' | 'sell' | 'hold';

interface ScreeningResult {
  symbol: string;
  name: string;
  industry: string;
  price: number;
  change: number;
  marketCap: string;
  pe: number;
  dividend: number;
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

const PAGE_SIZE = 20;
const REQUIRED_OWNERSHIP_OPTIONS = ['央企', '地方国企', '民企'];
const REQUIRED_EXCHANGE_OPTIONS = ['沪深', '北交所', '创业板'];
const SIGNAL_SORT_VALUE: Record<TradeSignal, number> = {
  sell: 1,
  hold: 2,
  buy: 3,
};

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

const parseMarketCap = (marketCap: string) => {
  const value = Number(marketCap.replace(/,/g, ''));
  return Number.isFinite(value) ? value : 0;
};

const getSortValue = (stock: ScreeningResult, field: SortField) => {
  if (field === 'price') return stock.price;
  if (field === 'marketCap') return parseMarketCap(stock.marketCap);
  if (field === 'pe') return stock.pe;
  if (field === 'dividend') return stock.dividend;
  return SIGNAL_SORT_VALUE[stock.signal];
};

const sortResults = (items: ScreeningResult[], sort: SortConfig) => (
  [...items].sort((a, b) => {
    const aValue = getSortValue(a, sort.field);
    const bValue = getSortValue(b, sort.field);
    const direction = sort.direction === 'asc' ? 1 : -1;

    if (aValue === bValue) {
      return a.symbol.localeCompare(b.symbol);
    }

    return aValue > bValue ? direction : -direction;
  })
);

const mergeResultsBySymbol = (existing: ScreeningResult[], incoming: ScreeningResult[]) => {
  const seen = new Set(existing.map((item) => item.symbol));
  return [...existing, ...incoming.filter((item) => !seen.has(item.symbol))];
};

export const Screener: React.FC = () => {
  const [activeExchanges, setActiveExchanges] = useState<string[]>([]);
  const [activeOwnership, setActiveOwnership] = useState<string[]>([]);
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
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const toggleFilter = (list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>, item: string) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
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
    mode: 'replace' | 'append' = 'replace',
    sortSource = sortConfig
  ) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/v1/screener/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFilterPayload(targetPage, numericSource, ownershipSource, exchangeSource, sortSource)),
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
    void fetchScreenerResults(1);
  };

  const handleClearFilters = () => {
    const resetFilters = baseNumericFilters.map((filter) => ({ ...filter }));
    setNumericFilters(resetFilters);
    setActiveOwnership(ownershipOptions);
    setActiveExchanges(exchangeOptions);
    void fetchScreenerResults(1, resetFilters, ownershipOptions, exchangeOptions);
  };

  const handleSortChange = (field: SortField) => {
    const nextSort: SortConfig = {
      field,
      direction: sortConfig.field === field && sortConfig.direction === 'desc' ? 'asc' : 'desc',
    };
    setSortConfig(nextSort);
    void fetchScreenerResults(1, numericFilters, activeOwnership, activeExchanges, 'replace', nextSort);
  };

  const handleLoadMore = () => {
    if (isLoading || results.length >= total) return;
    void fetchScreenerResults(page + 1, numericFilters, activeOwnership, activeExchanges, 'append', sortConfig);
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    params.set('filters', JSON.stringify(buildFilterPayload(1).filters));
    activeOwnership.forEach((item) => params.append('ownership', item));
    activeExchanges.forEach((item) => params.append('exchanges', item));
    window.location.assign(`/api/v1/screener/export?${params.toString()}`);
  };

  const enabledNumericFilters = numericFilters.filter((filter) => {
    const value = Number(filter.value);
    return filter.enabled && Number.isFinite(value);
  });
  const hasOwnershipFilter = activeOwnership.length !== ownershipOptions.length;
  const hasExchangeFilter = activeExchanges.length !== exchangeOptions.length;
  const hasActiveFilters = enabledNumericFilters.length > 0 || hasOwnershipFilter || hasExchangeFilter;
  const sortedResults = useMemo(() => sortResults(results, sortConfig), [results, sortConfig]);
  const loadedCount = results.length;
  const hasMoreResults = loadedCount < total;

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
  }, [hasMoreResults, isLoading, errorMessage, page, results.length, numericFilters, activeOwnership, activeExchanges, sortConfig]);

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

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-4xl font-extrabold font-headline text-primary tracking-tight">高级选股器</h1>
          <p className="text-on-surface-variant mt-2 font-medium">通过精准过滤发现高潜力中国 A 股标的。</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleClearFilters}
            data-feedback="筛选条件已清空"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl border border-outline-variant/20 text-on-surface-variant font-bold text-sm hover:bg-surface-container-low transition-colors"
          >
            <RotateCcw size={16} />
            一键清除
          </button>
          <button
            type="button"
            onClick={handleRunScreener}
            disabled={isLoading}
            data-feedback="正在运行真实数据筛选"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-surface font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
          >
            <Play size={16} fill="currentColor" />
            {isLoading ? '筛选中' : '运行筛选'}
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
            {numericFilters.map((filter) => (
              <div key={filter.key} className="space-y-3">
                <button
                  type="button"
                  onClick={() => toggleNumericFilter(filter.key)}
                  className="flex items-center gap-3 group cursor-pointer text-left"
                >
                  <div className={cn(
                    "w-5 h-5 rounded border flex items-center justify-center bg-surface transition-colors group-hover:border-primary",
                    filter.enabled ? "border-primary" : "border-outline"
                  )}>
                    {filter.enabled && <Check size={12} className="text-primary stroke-[3px]" />}
                  </div>
                  <span className="text-sm font-bold text-on-surface-variant group-hover:text-primary transition-colors">
                    {filter.label}
                  </span>
                </button>
                <div className="relative">
                  <input 
                    type="text" 
                    value={filter.value}
                    onChange={(event) => updateNumericFilterValue(filter.key, event.target.value)}
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
                {ownershipOptions.map(o => (
                  <button 
                    type="button"
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
                {exchangeOptions.map(e => (
                  <button 
                    type="button"
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
            <button type="button" aria-label="配置显示列" className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all rounded-lg">
              <Columns size={20} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50 text-[10px] font-black text-on-surface-variant uppercase tracking-[0.15em]">
                <th className="px-6 py-4 font-black whitespace-nowrap">代码/简称</th>
                <th className="px-6 py-4 font-black whitespace-nowrap">行业</th>
                <th className="px-6 py-4 font-black text-right whitespace-nowrap" aria-sort={sortConfig.field === 'price' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('price', '最新价 (¥)')}
                </th>
                <th className="px-6 py-4 font-black text-right whitespace-nowrap">涨跌幅</th>
                <th className="px-6 py-4 font-black text-right whitespace-nowrap">MA120</th>
                <th className="px-6 py-4 font-black text-right whitespace-nowrap">MA120 × 0.88</th>
                <th className="px-6 py-4 font-black text-right whitespace-nowrap">MA120 × 1.12</th>
                <th className="px-6 py-4 font-black text-center whitespace-nowrap" aria-sort={sortConfig.field === 'signal' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('signal', '信号', 'center')}
                </th>
                <th className="px-6 py-4 font-black text-right whitespace-nowrap" aria-sort={sortConfig.field === 'marketCap' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('marketCap', '市值 (亿 RMB)')}
                </th>
                <th className="px-6 py-4 font-black text-right whitespace-nowrap" aria-sort={sortConfig.field === 'pe' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('pe', '市盈率 (TTM)')}
                </th>
                <th className="px-6 py-4 font-black text-right whitespace-nowrap" aria-sort={sortConfig.field === 'dividend' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {renderSortableHeader('dividend', '股息率 (%)')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y-0">
              {isLoading && results.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-sm font-bold text-on-surface-variant">
                    正在加载真实选股数据...
                  </td>
                </tr>
              )}
              {!isLoading && errorMessage && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-sm font-bold text-error">
                    无法加载选股器数据: {errorMessage}
                  </td>
                </tr>
              )}
              {!isLoading && !errorMessage && results.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-sm font-bold text-on-surface-variant">
                    {availableTotal === 0
                      ? '暂无真实选股数据，请先到设置页点击“更新选股器数据”。'
                      : '当前筛选条件下无结果，请放宽条件或点击“一键清除”。'}
                    {availableTotal > 0 && hasActiveFilters && (
                      <div className="mt-3 text-xs font-medium text-on-surface-variant/80">
                        生效条件：数值筛选 {enabledNumericFilters.length} 项，公司性质 {activeOwnership.length}/{ownershipOptions.length} 项，上市地点 {activeExchanges.length}/{exchangeOptions.length} 项
                      </div>
                    )}
                  </td>
                </tr>
              )}
              {sortedResults.map((stock) => (
                <tr key={stock.symbol} className={cn(
                  "group cursor-pointer transition-colors border-b-2 border-surface-container-low/30",
                  "hover:bg-surface-container-low/50"
                )}>
                  <td className="px-6 py-5">
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
                  <td className="px-6 py-5 text-sm font-medium text-on-surface-variant whitespace-nowrap">
                    {stock.industry || '-'}
                  </td>
                  <td className="px-6 py-5 text-right font-bold text-on-surface tabular-nums">
                    {stock.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-5 text-right">
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
                  <td className="px-6 py-5 text-right font-medium text-on-surface-variant font-mono text-xs tabular-nums">
                    {stock.ma120.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-5 text-right font-medium text-on-surface-variant font-mono text-xs tabular-nums">
                    {stock.ma120Lower.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-5 text-right font-medium text-on-surface-variant font-mono text-xs tabular-nums">
                    {stock.ma120Upper.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-5 text-center">
                    <span className={cn(
                      "inline-flex items-center justify-center gap-1.5 min-w-16 px-3 py-1 rounded-lg text-xs font-black shadow-sm",
                      stock.signal === 'buy' && "bg-error-container/40 text-error",
                      stock.signal === 'sell' && "bg-tertiary-container/10 text-tertiary-container",
                      stock.signal === 'hold' && "bg-surface-container-highest text-on-surface-variant"
                    )}>
                      {stock.signal === 'buy' && <TrendingUp size={14} className="stroke-[3px]" />}
                      {stock.signal === 'sell' && <TrendingDown size={14} className="stroke-[3px]" />}
                      {getSignalLabel(stock.signal)}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-right font-medium text-on-surface-variant font-mono text-xs">
                    {stock.marketCap}
                  </td>
                  <td className="px-6 py-5 text-right font-medium text-on-surface-variant font-mono text-xs">
                    {stock.pe}
                  </td>
                  <td className="px-6 py-5 text-right font-medium text-on-surface-variant font-mono text-xs">
                    {stock.dividend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          ref={loadMoreRef}
          className="px-8 py-5 bg-surface-bright/50 border-t border-surface-container flex flex-col sm:flex-row items-center justify-between gap-4"
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
    </div>
  );
};
