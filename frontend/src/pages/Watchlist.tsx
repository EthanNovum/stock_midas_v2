import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  LineChart,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { StockKlineChart } from '@/src/components/StockKlineChart';
import { cn } from '@/src/lib/utils';
import { StockRef } from '@/src/types';

const DEFAULT_WATCHLIST_ID = 'sector-my-watchlist';

type ChartRange = 'intraday' | '5d' | 'daily' | 'weekly';

interface StockItem {
  id: string;
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  price?: number | null;
  vol?: string;
  pct?: number;
  tags?: string[];
  groupIds?: string[];
}

interface WatchlistGroup {
  id: string;
  name: string;
  groupType?: string;
  isDefault?: boolean;
  stocks: StockItem[];
}

interface ChartPoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  pct?: number;
}

interface ChartPayload {
  symbol: string;
  name: string;
  range: ChartRange;
  points: ChartPoint[];
}

interface StockSearchResult {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  industry?: string;
  latestPrice?: number | null;
  latestTradeDate?: string | null;
}

const CHART_RANGES: Array<{ id: ChartRange; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { id: 'intraday', label: '分时', icon: LineChart },
  { id: '5d', label: '5日', icon: LineChart },
  { id: 'daily', label: '日 K', icon: BarChart3 },
  { id: 'weekly', label: '周 K', icon: BarChart3 },
];

const formatPrice = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `¥ ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatPercent = (value = 0) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const uniqueStocks = (groups: WatchlistGroup[]) => {
  const stockMap = new Map<string, StockItem>();
  groups.forEach((group) => {
    group.stocks.forEach((stock) => {
      const existing = stockMap.get(stock.symbol);
      stockMap.set(stock.symbol, {
        ...existing,
        ...stock,
        groupIds: Array.from(new Set([...(existing?.groupIds ?? []), group.id, ...(stock.groupIds ?? [])])),
      });
    });
  });
  return Array.from(stockMap.values());
};

const normalizeSearchInput = (value: string) => value.trim();

interface WatchlistProps {
  onOpenStockDetail: (stock: StockRef) => void;
}

export const Watchlist: React.FC<WatchlistProps> = ({ onOpenStockDetail }) => {
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(DEFAULT_WATCHLIST_ID);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [editingTagSymbol, setEditingTagSymbol] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [selectedStock, setSelectedStock] = useState<StockItem | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>('daily');
  const [chartData, setChartData] = useState<ChartPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const defaultGroup = groups.find((group) => group.id === DEFAULT_WATCHLIST_ID) ?? groups[0];
  const customGroups = groups.filter((group) => group.id !== DEFAULT_WATCHLIST_ID);
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? defaultGroup;
  const stocks = activeGroup?.id === 'all' ? uniqueStocks(groups) : activeGroup?.stocks ?? [];

  const groupNameById = useMemo(() => {
    return groups.reduce<Record<string, string>>((acc, group) => {
      acc[group.id] = group.name;
      return acc;
    }, {});
  }, [groups]);

  const loadGroups = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/v1/watchlists?group_by=all');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { groups?: WatchlistGroup[] };
      const nextGroups = payload.groups ?? [];
      setGroups(nextGroups);

      if (!nextGroups.some((group) => group.id === selectedGroupId)) {
        setSelectedGroupId(nextGroups[0]?.id ?? DEFAULT_WATCHLIST_ID);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加载自选失败');
      setGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!selectedStock) return;

    let isCurrent = true;

    const loadSelectedChart = async () => {
      setIsChartLoading(true);

      try {
        const response = await fetch(`/api/v1/watchlists/stocks/${encodeURIComponent(selectedStock.symbol)}/chart?range=${chartRange}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as ChartPayload;
        if (isCurrent) {
          setChartData(payload);
        }
      } catch {
        if (isCurrent) {
          setChartData({
            symbol: selectedStock.symbol,
            name: selectedStock.name,
            range: chartRange,
            points: [],
          });
        }
      } finally {
        if (isCurrent) {
          setIsChartLoading(false);
        }
      }
    };

    loadSelectedChart();

    return () => {
      isCurrent = false;
    };
  }, [selectedStock, chartRange]);

  useEffect(() => {
    if (!selectedStock && stocks.length > 0) {
      setSelectedStock(stocks[0]);
    }
  }, [selectedStock, stocks]);

  useEffect(() => {
    if (!selectedStock) return;

    const freshStock = stocks.find((stock) => stock.symbol === selectedStock.symbol);
    if (freshStock && freshStock !== selectedStock) {
      setSelectedStock(freshStock);
    }
  }, [selectedStock, stocks]);

  const selectStock = (stock: StockItem) => {
    setSelectedStock(stock);
    setChartData(null);
  };

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/v1/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, groupType: 'custom' }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setNewGroupName('');
      await loadGroups();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '新增分组失败');
    } finally {
      setIsSaving(false);
    }
  };

  const saveGroupName = async (groupId: string) => {
    const name = editingGroupName.trim();
    if (!name) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/watchlists/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setEditingGroupId(null);
      setEditingGroupName('');
      await loadGroups();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '修改分组失败');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (groupId === DEFAULT_WATCHLIST_ID) return;
    if (!window.confirm('删除该分组后，分组内股票不会从自选分组中移除。确认删除？')) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/watchlists/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSelectedGroupId(DEFAULT_WATCHLIST_ID);
      await loadGroups();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '删除分组失败');
    } finally {
      setIsSaving(false);
    }
  };

  const searchStocks = async (queryText: string) => {
    const query = normalizeSearchInput(queryText);
    if (!query) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=8`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { items?: StockSearchResult[] };
      const stocks = (payload.items ?? []).filter((item) => item.type === 'stock');
      setSearchResults(stocks);
    } catch (error) {
      setSearchResults([]);
      setErrorMessage(error instanceof Error ? error.message : '搜索股票失败');
    } finally {
      setIsSearching(false);
    }
  };

  const addSearchResultToWatchlist = async (result: StockSearchResult) => {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/v1/watchlists/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: result.id }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadGroups();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '添加股票失败，请确认已同步该股票行情');
    } finally {
      setIsSaving(false);
    }
  };

  const addStockToGroup = async (stock: StockItem, groupId: string) => {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/watchlists/${encodeURIComponent(groupId)}/stocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: stock.symbol }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadGroups();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '添加股票分组失败');
    } finally {
      setIsSaving(false);
    }
  };

  const removeStockFromGroup = async (stock: StockItem, groupId: string) => {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/v1/watchlists/${encodeURIComponent(groupId)}/stocks/${encodeURIComponent(stock.symbol)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (activeGroup?.id === groupId && selectedStock?.symbol === stock.symbol) {
        setSelectedStock(null);
        setChartData(null);
      }
      await loadGroups();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '删除股票分组失败');
    } finally {
      setIsSaving(false);
    }
  };

  const removeStockFromActiveGroup = async (stock: StockItem) => {
    if (!activeGroup) return;
    await removeStockFromGroup(stock, activeGroup.id);
  };

  const startEditTags = (stock: StockItem) => {
    setEditingTagSymbol(stock.symbol);
    setEditingTags(stock.tags ?? []);
    setNewTagInput('');
  };

  const cancelEditTags = () => {
    setEditingTagSymbol(null);
    setEditingTags([]);
    setNewTagInput('');
  };

  const addTagDraft = () => {
    const text = newTagInput.trim();
    if (!text) return;
    if (text.length > 20) {
      setErrorMessage('单个标签不能超过20个字符');
      return;
    }
    if (editingTags.includes(text)) {
      setNewTagInput('');
      return;
    }
    if (editingTags.length >= 10) {
      setErrorMessage('标签最多10个');
      return;
    }
    setEditingTags((current) => [...current, text]);
    setNewTagInput('');
  };

  const removeTagDraft = (tag: string) => {
    setEditingTags((current) => current.filter((item) => item !== tag));
  };

  const saveStockTags = async (stock: StockItem) => {
    const pendingTag = newTagInput.trim();
    let nextTags = editingTags;
    if (pendingTag) {
      if (pendingTag.length > 20) {
        setErrorMessage('单个标签不能超过20个字符');
        return;
      }
      if (!nextTags.includes(pendingTag)) {
        nextTags = [...nextTags, pendingTag];
      }
    }
    if (nextTags.length > 10) {
      setErrorMessage('标签最多10个');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/v1/watchlists/stocks/${encodeURIComponent(stock.symbol)}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: nextTags }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(payload?.detail || `HTTP ${response.status}`);
      }
      cancelEditTags();
      await loadGroups();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存标签失败');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const keyword = searchQuery.trim();
    if (!keyword) {
      setSearchResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void searchStocks(keyword);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 pb-2 border-b border-surface-container-highest/20">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h2 className="text-4xl font-[800] font-headline text-primary">我的自选</h2>
            <span className="text-xs font-black text-on-surface-variant bg-surface-container-low px-2.5 py-1 rounded-full border border-outline-variant/10">
              空数据起步
            </span>
          </div>
          <p className="text-sm font-medium text-on-surface-variant max-w-2xl leading-relaxed">
            默认分组为“自选分组”。新增股票会自动加入默认分组，也可以同时勾选多个自定义分组。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative">
            <label className="flex items-center gap-2 bg-surface-container-lowest border border-outline-variant/20 rounded-xl px-4 py-2">
              <Search size={16} className="text-on-surface-variant" />
              <input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setHasSearched(false);
                }}
                placeholder="输入名称或代码，如 贵州茅台"
                className="bg-transparent outline-none text-sm font-bold text-primary placeholder:text-on-surface-variant/60 w-56"
              />
            </label>

            {(searchResults.length > 0 || hasSearched) && (
              <div className="absolute right-0 top-12 z-30 w-full sm:w-[360px] rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl overflow-hidden">
                {searchResults.length > 0 ? (
                  searchResults.map((result) => (
                    <div
                      key={result.id}
                      className="flex items-center justify-between gap-2 border-b border-outline-variant/10 px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0 text-left">
                        <span className="block truncate text-sm font-black text-primary">{result.title}</span>
                        <span className="mt-1 block truncate text-xs font-bold text-on-surface-variant">
                          {result.id} · {result.industry ?? result.subtitle ?? '未分类'}
                          {typeof result.latestPrice === 'number' ? ` · ${formatPrice(result.latestPrice)}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void addSearchResultToWatchlist(result)}
                        disabled={isSaving}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
                      >
                        <Plus size={12} className="stroke-[3px]" />
                        加入自选
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm font-bold text-on-surface-variant">
                    {isSearching ? '正在搜索股票...' : '没有搜索到可添加的股票'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedGroupId(DEFAULT_WATCHLIST_ID)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-black transition-all',
              selectedGroupId === DEFAULT_WATCHLIST_ID
                ? 'bg-primary text-white border-primary shadow-sm'
                : 'bg-surface-container-lowest text-primary border-outline-variant/20 hover:border-primary/40'
            )}
          >
            <Tags size={15} />
            {groupNameById[DEFAULT_WATCHLIST_ID] ?? '自选分组'}
          </button>

          {customGroups.map((group) => (
            <div
              key={group.id}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-2 py-1.5 transition-all',
                selectedGroupId === group.id
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-surface-container-lowest text-primary border-outline-variant/20 hover:border-primary/40'
              )}
            >
              {editingGroupId === group.id ? (
                <>
                  <input
                    value={editingGroupName}
                    onChange={(event) => setEditingGroupName(event.target.value)}
                    className="w-28 bg-transparent outline-none text-sm font-black"
                    autoFocus
                  />
                  <button type="button" onClick={() => saveGroupName(group.id)} aria-label="保存分组名称">
                    <Check size={15} />
                  </button>
                  <button type="button" onClick={() => setEditingGroupId(null)} aria-label="取消修改分组">
                    <X size={15} />
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setSelectedGroupId(group.id)} className="px-2 text-sm font-black">
                    {group.name}
                    <span className="ml-2 opacity-70">{group.stocks.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingGroupId(group.id);
                      setEditingGroupName(group.name);
                    }}
                    aria-label={`修改 ${group.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => deleteGroup(group.id)} aria-label={`删除 ${group.name}`}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
          <div className="flex items-center gap-2">
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') createGroup();
              }}
              placeholder="新分组名称"
              className="h-10 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm font-bold text-primary outline-none"
            />
            <button
              type="button"
              onClick={createGroup}
              disabled={isSaving || !newGroupName.trim()}
              className="h-10 inline-flex items-center gap-2 rounded-xl bg-surface-container-high text-primary px-4 text-sm font-black disabled:opacity-50"
            >
              <Plus size={15} />
              新增分组
            </button>
          </div>
        </div>
      </section>

      {errorMessage && (
        <div className="rounded-xl border border-error/20 bg-error-container/20 px-4 py-3 text-sm font-bold text-error">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_460px] gap-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-[800] font-headline text-primary">{activeGroup?.name ?? '自选分组'}</h3>
              <p className="text-sm font-bold text-on-surface-variant">{stocks.length} 个标的</p>
            </div>
            <button
              type="button"
              onClick={loadGroups}
              className="inline-flex items-center gap-2 rounded-xl bg-surface-container-lowest border border-outline-variant/20 px-3 py-2 text-sm font-black text-primary"
            >
              <RefreshCw size={15} className={cn(isLoading && 'animate-spin')} />
              刷新
            </button>
          </div>

          {isLoading && stocks.length === 0 && (
            <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center text-sm font-bold text-on-surface-variant">
              正在加载自选分组...
            </div>
          )}

          {!isLoading && stocks.length === 0 && (
            <div className="rounded-xl border border-dashed border-outline-variant/30 bg-surface-container-lowest p-10 text-center">
              <p className="text-lg font-[800] font-headline text-primary">暂无自选股票</p>
              <p className="mt-2 text-sm font-medium text-on-surface-variant">
                输入股票代码添加后，会先进入“自选分组”，也可以同步加入多个自定义分组。
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            {stocks.map((stock) => (
              <article
                key={`${activeGroup?.id}-${stock.symbol}`}
                onClick={() => selectStock(stock)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectStock(stock);
                  }
                }}
                className={cn(
                  'bg-surface-container-lowest rounded-xl p-5 border transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  selectedStock?.symbol === stock.symbol
                    ? 'border-primary shadow-md shadow-primary/5'
                    : 'border-transparent hover:border-outline-variant/30'
                )}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenStockDetail({ symbol: stock.symbol, name: stock.name });
                      }}
                      className="w-14 h-14 rounded-xl bg-surface-container-low flex items-center justify-center text-primary font-black text-xs font-headline shrink-0 hover:bg-primary hover:text-white transition-all"
                    >
                      {stock.id}
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            selectStock(stock);
                          }}
                          className="font-headline font-[800] text-xl text-primary hover:text-primary-container transition-colors text-left"
                        >
                          {stock.name}
                        </button>
                        {(stock.tags ?? []).map((tag) => (
                          <span
                            key={`${stock.symbol}-tag-${tag}`}
                            className="inline-flex items-center rounded-lg border border-primary/25 bg-primary/5 px-2 py-0.5 text-[10px] font-black text-primary"
                          >
                            {tag}
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            startEditTags(stock);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/20 bg-surface-container-low px-2 py-0.5 text-[10px] font-black text-on-surface-variant hover:text-primary"
                        >
                          <Pencil size={11} className="stroke-[3px]" />
                          标签
                        </button>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black text-on-surface-variant">{stock.symbol}</span>
                        <span className="text-xs font-bold text-on-surface-variant/70">{stock.industry ?? stock.sector ?? '未分类'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col md:items-end gap-2">
                    <div className="font-headline font-[800] text-2xl text-on-surface tabular-nums">{formatPrice(stock.price)}</div>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-black',
                        (stock.pct ?? 0) >= 0 ? 'bg-error-container/40 text-error' : 'bg-tertiary-container/10 text-tertiary-container'
                      )}>
                        {(stock.pct ?? 0) >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                        {formatPercent(stock.pct)}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeStockFromActiveGroup(stock);
                        }}
                        disabled={isSaving}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-black text-on-surface-variant hover:bg-surface-container-low hover:text-error disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        移除
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {editingTagSymbol === stock.symbol && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-2 py-1.5">
                      {editingTags.map((tag) => (
                        <span key={`${stock.symbol}-editing-${tag}`} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">
                          {tag}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeTagDraft(tag);
                            }}
                            className="rounded-full p-0.5 hover:bg-primary/20"
                            aria-label={`删除标签 ${tag}`}
                          >
                            <X size={10} className="stroke-[3px]" />
                          </button>
                        </span>
                      ))}
                      <input
                        value={newTagInput}
                        onChange={(event) => setNewTagInput(event.target.value.slice(0, 20))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            event.stopPropagation();
                            addTagDraft();
                          }
                        }}
                        maxLength={20}
                        placeholder="输入标签"
                        className="w-24 bg-transparent text-xs font-bold text-primary outline-none"
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          addTagDraft();
                        }}
                        className="rounded-full p-0.5 text-primary hover:bg-surface-container-low"
                        aria-label={`新增 ${stock.name} 标签`}
                      >
                        <Plus size={12} className="stroke-[3px]" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void saveStockTags(stock);
                        }}
                        disabled={isSaving}
                        className="rounded-full p-0.5 text-primary hover:bg-surface-container-low disabled:opacity-50"
                        aria-label={`保存 ${stock.name} 标签`}
                      >
                        <Check size={12} className="stroke-[3px]" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          cancelEditTags();
                        }}
                        className="rounded-full p-0.5 text-on-surface-variant hover:bg-surface-container-low"
                        aria-label={`取消编辑 ${stock.name} 标签`}
                      >
                        <X size={12} className="stroke-[3px]" />
                      </button>
                    </div>
                  )}
                  {(stock.groupIds ?? [activeGroup?.id].filter(Boolean) as string[]).map((groupId) => (
                    <span key={groupId} className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-low px-2.5 py-1 text-xs font-black text-on-surface-variant">
                      {groupNameById[groupId] ?? groupId}
                      {groupId !== DEFAULT_WATCHLIST_ID && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeStockFromGroup(stock, groupId);
                          }}
                          disabled={isSaving}
                          className="rounded-full p-0.5 hover:bg-surface-container-high hover:text-error disabled:opacity-50"
                          aria-label={`从 ${groupNameById[groupId] ?? groupId} 移除 ${stock.name}`}
                        >
                          <X size={12} className="stroke-[3px]" />
                        </button>
                      )}
                    </span>
                  ))}
                  {customGroups
                    .filter((group) => !(stock.groupIds ?? []).includes(group.id))
                    .map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          addStockToGroup(stock, group.id);
                        }}
                        disabled={isSaving}
                        className="inline-flex items-center gap-1 rounded-full border border-outline-variant/20 bg-surface-container-lowest px-2.5 py-1 text-xs font-black text-primary hover:border-primary/40 disabled:opacity-50"
                        aria-label={`把 ${stock.name} 加入 ${group.name}`}
                      >
                        <Plus size={12} className="stroke-[3px]" />
                        {group.name}
                      </button>
                    ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="xl:sticky xl:top-24 h-fit rounded-xl bg-surface-container-lowest border border-outline-variant/20 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-[800] font-headline text-primary">
                {selectedStock?.name ?? 'K 线图'}
              </h3>
              <p className="mt-1 text-sm font-bold text-on-surface-variant">
                {selectedStock?.symbol ?? '点击股票名称查看走势'}
              </p>
            </div>
            {isChartLoading && <RefreshCw size={18} className="animate-spin text-primary" />}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {CHART_RANGES.map((range) => {
              const Icon = range.icon;
              return (
                <button
                  key={range.id}
                  type="button"
                  onClick={() => setChartRange(range.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black transition-all',
                    chartRange === range.id
                      ? 'bg-primary text-white'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-primary'
                  )}
                >
                  <Icon size={13} />
                  {range.label}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            {chartData && chartData.points.length > 0 ? (
              <StockKlineChart
                points={chartData.points}
                mode={chartRange === 'daily' || chartRange === 'weekly' ? 'kline' : 'line'}
                heightClassName="h-80"
                emptyMessage="暂无已同步走势数据"
              />
            ) : (
              <div className="h-72 rounded-xl bg-surface-container-low flex items-center justify-center text-sm font-bold text-on-surface-variant">
                暂无已同步走势数据
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
