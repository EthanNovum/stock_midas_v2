import React, { useState } from 'react';
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
  Clock
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { TabId } from '@/src/types';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  const navItems = [
    { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
    { id: 'screener', label: '选股器', icon: Search },
    { id: 'portfolio', label: '投资组合', icon: PieChart },
    { id: 'watchlist', label: '自选股', icon: Star },
    { id: 'reports', label: '研究报告', icon: FileText },
    { id: 'settings', label: '设置', icon: Settings },
  ] as const;

  const lastUpdated = new Date().toLocaleString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  });

  return (
    <div className="flex min-h-screen bg-surface">
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
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-primary text-surface rounded-full flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all z-50 border-2 border-surface"
        >
          {isCollapsed ? <ChevronRight size={14} strokeWidth={3} /> : <ChevronLeft size={14} strokeWidth={3} />}
        </button>

        <ul className="flex flex-col gap-2 font-headline font-semibold text-sm">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
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
          <button className={cn(
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
            <button className="p-2 rounded-full hover:bg-surface-container-highest transition-colors relative">
              <Bell size={20} className="text-primary" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full border-2 border-surface" />
            </button>
            <button className="p-1 rounded-full hover:bg-surface-container-highest transition-colors flex items-center gap-2 border border-outline-variant/10">
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

