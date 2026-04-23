import React, { useEffect, useRef, useState } from 'react';
import { 
  LayoutDashboard, 
  Search, 
  PieChart, 
  Star, 
  FileText, 
  Settings, 
  LogOut,
  Bell,
  User,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { TabId } from '@/src/types';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

interface DataSyncDataset {
  scope: string;
  rows: number;
  updatedAt?: string | null;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('尚未同步');
  const feedbackTimer = useRef<number | null>(null);
  
  const navItems = [
    { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
    { id: 'screener', label: '选股器', icon: Search },
    { id: 'portfolio', label: '投资组合', icon: PieChart },
    { id: 'watchlist', label: '自选股', icon: Star },
    { id: 'reports', label: '研究报告', icon: FileText },
    { id: 'settings', label: '设置', icon: Settings },
  ] as const;

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) {
        window.clearTimeout(feedbackTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const formatUpdatedAt = (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '尚未同步';

      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    };

    const loadDataLastUpdated = async () => {
      try {
        const response = await fetch('/api/v1/data-sync/datasets');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json() as { items?: DataSyncDataset[] };
        const timestamps = (payload.items ?? [])
          .map((item) => item.updatedAt)
          .filter((value): value is string => Boolean(value));

        if (!timestamps.length) {
          setLastUpdated('尚未同步');
          return;
        }

        const latestTimestamp = timestamps.sort(
          (a, b) => new Date(b).getTime() - new Date(a).getTime()
        )[0];
        setLastUpdated(formatUpdatedAt(latestTimestamp));
      } catch {
        setLastUpdated('同步状态未知');
      }
    };

    void loadDataLastUpdated();

    const handleRefresh = () => {
      void loadDataLastUpdated();
    };

    window.addEventListener('focus', handleRefresh);
    window.addEventListener('midas:data-sync-updated', handleRefresh);

    return () => {
      window.removeEventListener('focus', handleRefresh);
      window.removeEventListener('midas:data-sync-updated', handleRefresh);
    };
  }, []);

  const showFeedback = (message: string) => {
    if (feedbackTimer.current) {
      window.clearTimeout(feedbackTimer.current);
    }

    setFeedback(message);
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimer.current = null;
    }, 2200);
  };

  const handleButtonFeedback = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const button = target.closest('button');

    if (!button || !event.currentTarget.contains(button) || button.disabled) {
      return;
    }

    const rawLabel = button.dataset.feedback
      || button.getAttribute('aria-label')
      || button.getAttribute('title')
      || button.textContent;
    const label = rawLabel?.replace(/\s+/g, ' ').trim() || '按钮操作';

    showFeedback(label.startsWith('已') ? label : `已触发：${label}`);
  };

  return (
    <div className="flex min-h-screen bg-surface" onClickCapture={handleButtonFeedback}>
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-6 top-20 z-[100] flex max-w-sm items-start gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-5 py-4 text-primary shadow-2xl shadow-primary/10 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-tertiary-container stroke-[3px]" />
          <div>
            <p className="font-headline text-sm font-[900] leading-tight">操作已接收</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-on-surface-variant">{feedback}</p>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <nav className={cn(
        "fixed left-0 top-0 h-screen z-50 flex flex-col py-8 px-4 border-r-0 tracking-tight transition-all duration-300",
        "bg-gradient-to-r from-surface-container-low to-surface",
        isCollapsed ? "w-20" : "w-64"
      )}>
        <div className={cn("px-4 mb-10 overflow-hidden whitespace-nowrap transition-opacity", isCollapsed ? "opacity-0" : "opacity-100")}>
          <h2 className="text-xl font-[800] text-primary font-headline">Midas 点金术选股</h2>
          <p className="text-[10px] text-on-surface-variant font-medium mt-1 uppercase tracking-widest">
            Terminal V2.5
          </p>
        </div>

        {/* Collapse Toggle */}
        <button 
          type="button"
          aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-primary text-surface rounded-full flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all z-50 border-2 border-surface"
        >
          {isCollapsed ? <ChevronRight size={14} strokeWidth={3} /> : <ChevronLeft size={14} strokeWidth={3} />}
        </button>

        <ul className="flex flex-col gap-2 font-headline font-semibold text-sm">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full px-4 py-3 flex items-center gap-3 rounded-full transition-all duration-300 active:scale-[0.98] overflow-hidden",
                  activeTab === item.id 
                    ? "bg-tertiary-fixed text-primary shadow-sm" 
                    : "text-on-surface-variant hover:bg-surface-container-highest"
                )}
              >
                <div className="flex-shrink-0">
                  <item.icon size={20} fill={activeTab === item.id ? "currentColor" : "none"} />
                </div>
                {!isCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-auto px-4">
          <button
            type="button"
            className={cn(
            "flex items-center gap-3 text-on-surface-variant hover:text-primary transition-colors text-sm font-semibold font-headline overflow-hidden",
            isCollapsed && "justify-center"
          )}>
            <div className="flex-shrink-0">
              <LogOut size={18} />
            </div>
            {!isCollapsed && <span className="whitespace-nowrap">帮助中心</span>}
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className={cn("flex-1 flex flex-col transition-all duration-300", isCollapsed ? "ml-20" : "ml-64")}>
        {/* Header */}
        <header className="sticky top-0 z-40 bg-surface/80 backdrop-blur-xl flex justify-between items-center px-8 h-16 w-full shadow-[0_24px_48px_rgba(25,28,29,0.04)]">
          <div className="flex items-center gap-8">
            <div className="flex items-center w-80 bg-surface-container-highest rounded-full px-4 py-2 hover:bg-surface-container-highest/80 transition-colors">
              <Search className="text-on-surface-variant mr-3" size={18} />
              <input 
                type="text" 
                placeholder="搜索代码、研报..." 
                className="bg-transparent border-none outline-none text-sm w-full font-sans text-on-surface placeholder:text-outline"
              />
            </div>
            
            {/* Update Notification */}
            <div className="hidden md:flex items-center gap-2 text-[10px] font-black text-on-surface-variant uppercase tracking-widest bg-surface-container-low px-4 py-1.5 rounded-full border border-outline-variant/10">
              <Clock size={12} className="text-primary" />
              最后更新: <span className="text-primary ml-1">{lastUpdated}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="查看通知"
              className="p-2 rounded-full hover:bg-surface-container-highest transition-colors relative"
            >
              <Bell size={20} className="text-primary" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full border-2 border-surface" />
            </button>
            <button
              type="button"
              aria-label="打开用户菜单"
              className="p-1 rounded-full hover:bg-surface-container-highest transition-colors flex items-center gap-2 border border-outline-variant/10"
            >
              <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center text-tertiary-fixed font-bold text-xs">
                JD
              </div>
            </button>
          </div>
        </header>

        <main className="p-8 flex-1 animate-in fade-in duration-500">
          {children}
        </main>
      </div>
    </div>
  );
};
