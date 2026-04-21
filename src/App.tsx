import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Screener } from './pages/Screener';
import { Portfolio } from './pages/Portfolio';
import { Watchlist } from './pages/Watchlist';
import { Settings } from './pages/Settings';
import { Reports } from './pages/Reports';
import { TabId } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'screener':
        return <Screener />;
      case 'portfolio':
        return <Portfolio />;
      case 'watchlist':
        return <Watchlist />;
      case 'settings':
        return <Settings />;
      case 'reports':
        return <Reports />;
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
