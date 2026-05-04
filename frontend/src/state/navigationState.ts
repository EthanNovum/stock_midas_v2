import { StockRef, TabId } from '@/src/types';

const STORAGE_KEY = 'midas:navigation-state:v1';
const TAB_IDS: readonly TabId[] = ['dashboard', 'screener', 'portfolio', 'watchlist', 'stockDetail', 'reports', 'settings'];

export interface NavigationState {
  activeTab: TabId;
  selectedStockRef: StockRef | null;
  reportStockFilter: StockRef | null;
}

const DEFAULT_NAVIGATION_STATE: NavigationState = {
  activeTab: 'dashboard',
  selectedStockRef: null,
  reportStockFilter: null,
};

const isTabId = (value: unknown): value is TabId => (
  typeof value === 'string' && TAB_IDS.includes(value as TabId)
);

const isStockRef = (value: unknown): value is StockRef => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StockRef>;
  return typeof candidate.symbol === 'string' && candidate.symbol.trim().length > 0;
};

export const readNavigationState = (): NavigationState => {
  if (typeof window === 'undefined') return DEFAULT_NAVIGATION_STATE;

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) return DEFAULT_NAVIGATION_STATE;

    const parsed = JSON.parse(rawValue) as Partial<NavigationState>;
    const activeTab = isTabId(parsed.activeTab) ? parsed.activeTab : DEFAULT_NAVIGATION_STATE.activeTab;
    const selectedStockRef = isStockRef(parsed.selectedStockRef) ? parsed.selectedStockRef : null;
    const reportStockFilter = isStockRef(parsed.reportStockFilter) ? parsed.reportStockFilter : null;

    return {
      activeTab,
      selectedStockRef,
      reportStockFilter,
    };
  } catch {
    return DEFAULT_NAVIGATION_STATE;
  }
};

export const writeNavigationState = (state: NavigationState) => {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
