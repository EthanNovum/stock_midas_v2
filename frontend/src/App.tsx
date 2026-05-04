import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Screener } from './pages/Screener';
import { Portfolio } from './pages/Portfolio';
import { Watchlist } from './pages/Watchlist';
import { Settings } from './pages/Settings';
import { Reports } from './pages/Reports';
import { StockDetail } from './pages/StockDetail';
import { readNavigationState, writeNavigationState } from './state/navigationState';
import { StockRef, TabId } from './types';

export default function App() {
  const initialNavigationState = useMemo(() => readNavigationState(), []);
  const [activeTab, setActiveTab] = useState<TabId>(initialNavigationState.activeTab);
  const [selectedStockRef, setSelectedStockRef] = useState<StockRef | null>(initialNavigationState.selectedStockRef);
  const [reportStockFilter, setReportStockFilter] = useState<StockRef | null>(initialNavigationState.reportStockFilter);

  useEffect(() => {
    writeNavigationState({
      activeTab,
      selectedStockRef,
      reportStockFilter,
    });
  }, [activeTab, selectedStockRef, reportStockFilter]);

  const openStockDetail = (stock: StockRef) => {
    setSelectedStockRef(stock);
    setActiveTab('stockDetail');
  };

  const openReportsForStock = (stock: StockRef) => {
    setReportStockFilter(stock);
    setActiveTab('reports');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard onOpenWatchlist={() => setActiveTab('watchlist')} onOpenStockDetail={openStockDetail} />;
      case 'screener':
        return <Screener onOpenStockDetail={openStockDetail} />;
      case 'portfolio':
        return <Portfolio onOpenStockDetail={openStockDetail} />;
      case 'watchlist':
        return <Watchlist onOpenStockDetail={openStockDetail} />;
      case 'stockDetail':
        return <StockDetail stockRef={selectedStockRef} onSelectStock={openStockDetail} onViewReports={openReportsForStock} />;
      case 'settings':
        return <Settings />;
      case 'reports':
        return <Reports stockFilter={reportStockFilter} onClearStockFilter={() => setReportStockFilter(null)} />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      {renderContent()}
    </Layout>
  );
}
