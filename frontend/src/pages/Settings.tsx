import React, { useEffect, useState } from 'react';
import { 
  Palette, 
  Check, 
  Sun,
  Moon,
  Database,
  RefreshCw,
  Activity,
  AlertCircle,
  Pause,
  Play,
  Square
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

type DataSyncStatus = 'idle' | 'queued' | 'running' | 'paused' | 'stopped' | 'success' | 'failed';
type DataSyncUpdateMode = 'full' | 'price_only';

interface DataSyncJob {
  jobId: string;
  status: Exclude<DataSyncStatus, 'idle'>;
  limit?: number;
  updateMode?: DataSyncUpdateMode;
  startDate?: string | null;
  endDate?: string | null;
  fullUniverse?: boolean;
  totalTasks?: number;
  completedTasks?: number;
  progressPercent?: number;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedRows?: number;
  failedRows?: number;
  isRealtime?: boolean;
  backend?: 'redis' | 'sqlite-fallback';
  pollIntervalMs?: number;
}

interface DataSyncDataset {
  scope: string;
  rows: number;
  stockCount?: number;
  fromDate?: string | null;
  toDate?: string | null;
  updatedAt?: string | null;
}

interface SettingsResponse {
  appearance: {
    theme: 'light' | 'dark';
  };
}

type ThemeMode = 'light' | 'dark';

const dataSyncScopeDescriptions = [
  { id: 'stock_basic', label: 'stock_basic', description: '股票代码、名称、交易所、公司属性、行业等基础档案' },
  { id: 'daily_prices', label: 'daily_prices', description: '日线行情，包括开盘、收盘、最高、最低、成交量和日期' },
  { id: 'fundamentals', label: 'fundamentals', description: '估值和筛选指标，包括市值、PE、PB、股息率、MA120 和信号' },
] as const;

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

export const Settings: React.FC = () => {
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [syncStatus, setSyncStatus] = useState<DataSyncStatus>('idle');
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('等待首次同步');
  const [lastSyncAt, setLastSyncAt] = useState('尚未同步');
  const [updatedRows, setUpdatedRows] = useState(0);
  const [failedRows, setFailedRows] = useState(0);
  const [syncLimit, setSyncLimit] = useState('300');
  const [syncUpdateMode, setSyncUpdateMode] = useState<DataSyncUpdateMode>('full');
  const defaultSyncRange = getDateRangePreset('1y');
  const [syncStartDate, setSyncStartDate] = useState(defaultSyncRange.startDate);
  const [syncEndDate, setSyncEndDate] = useState(defaultSyncRange.endDate);
  const [syncFullUniverse, setSyncFullUniverse] = useState(false);
  const [dataSyncDatasets, setDataSyncDatasets] = useState<DataSyncDataset[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [completedTasks, setCompletedTasks] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [syncIsRealtime, setSyncIsRealtime] = useState(false);
  const [syncBackend, setSyncBackend] = useState<'redis' | 'sqlite-fallback'>('sqlite-fallback');
  const [pollIntervalMs, setPollIntervalMs] = useState(3000);

  const themes = [
    { id: 'light', label: '浅色模式', icon: Sun },
    { id: 'dark', label: '深色模式', icon: Moon },
  ] as const;

  const isSyncing = syncStatus === 'queued' || syncStatus === 'running';
  const isSyncActive = syncStatus === 'queued' || syncStatus === 'running' || syncStatus === 'paused';
  const stockBasicDataset = dataSyncDatasets.find((item) => item.scope === 'stock_basic');
  const dailyPricesDataset = dataSyncDatasets.find((item) => item.scope === 'daily_prices');
  const currentDataRange = dailyPricesDataset?.fromDate && dailyPricesDataset?.toDate
    ? `${dailyPricesDataset.fromDate} 至 ${dailyPricesDataset.toDate}`
    : '暂无日线数据';

  const loadDataSyncDatasets = async () => {
    const response = await fetch('/api/v1/data-sync/datasets');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json() as { items?: DataSyncDataset[] };
    setDataSyncDatasets(payload.items ?? []);
  };

  const applySyncJob = (job: DataSyncJob) => {
    setSyncStatus(job.status === 'success' ? 'success' : job.status === 'failed' ? 'failed' : job.status);
    setSyncMessage(job.message ?? (job.status === 'success' ? '已完成' : 'AkShare 数据任务处理中'));
    setTotalTasks(job.totalTasks ?? 0);
    setCompletedTasks(job.completedTasks ?? 0);
    setProgressPercent(job.progressPercent ?? 0);
    setUpdatedRows(job.updatedRows ?? 0);
    setFailedRows(job.failedRows ?? 0);
    setSyncIsRealtime(Boolean(job.isRealtime));
    setSyncBackend(job.backend ?? 'sqlite-fallback');
    setPollIntervalMs(job.pollIntervalMs && job.pollIntervalMs > 0 ? job.pollIntervalMs : (job.status === 'running' ? 2000 : 3000));
    if (job.limit) setSyncLimit(String(job.limit));
    if (job.updateMode) setSyncUpdateMode(job.updateMode);
    if (job.startDate) setSyncStartDate(job.startDate);
    if (job.endDate) setSyncEndDate(job.endDate);
    setSyncFullUniverse(Boolean(job.fullUniverse));
    if (job.status === 'success') {
      window.dispatchEvent(new CustomEvent('midas:data-sync-updated'));
      void loadDataSyncDatasets().catch(() => setDataSyncDatasets([]));
    }

    if (job.finishedAt || job.startedAt) {
      const displayTime = new Date(job.finishedAt ?? job.startedAt!).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      setLastSyncAt(displayTime);
    }
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const response = await fetch('/api/v1/settings');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json() as SettingsResponse;
        if (!isMounted) return;

        setTheme(payload.appearance.theme);
      } catch (error) {
        if (!isMounted) return;
        setSettingsMessage(error instanceof Error ? `设置加载失败: ${error.message}` : '设置加载失败');
      }
    };

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void loadDataSyncDatasets().catch(() => setDataSyncDatasets([]));
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadLatestJob = async () => {
      try {
        const response = await fetch('/api/v1/data-sync/jobs/latest');
        if (response.status === 404) return;
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const job = await response.json() as DataSyncJob;
        if (!isMounted) return;

        setSyncJobId(job.jobId);
        applySyncJob(job);
      } catch (error) {
        if (!isMounted) return;

        setSyncStatus('failed');
        setSyncMessage(
          error instanceof Error
            ? `无法连接后端数据同步接口: ${error.message}`
            : '无法连接后端数据同步接口'
        );
      }
    };

    loadLatestJob();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!syncJobId || !isSyncActive) return;

    const interval = window.setInterval(() => {
      void refreshJobStatus(syncJobId, { suppressError: true });
    }, Math.max(1000, pollIntervalMs));

    return () => {
      window.clearInterval(interval);
    };
  }, [syncJobId, isSyncActive, pollIntervalMs]);

  const refreshJobStatus = async (jobId = syncJobId, options?: { suppressError?: boolean }) => {
    if (!jobId) return;

    try {
      const response = await fetch(`/api/v1/data-sync/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const job = await response.json() as DataSyncJob;
      applySyncJob(job);
    } catch (error) {
      if (options?.suppressError) return;
      setSyncStatus('failed');
      setSyncMessage(error instanceof Error ? `状态查询失败: ${error.message}` : '状态查询失败');
    }
  };

  const handleSyncControl = async (action: 'pause' | 'resume' | 'stop') => {
    if (!syncJobId) return;

    try {
      const response = await fetch(`/api/v1/data-sync/jobs/${syncJobId}/${action}`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const job = await response.json() as DataSyncJob;
      applySyncJob(job);
    } catch (error) {
      setSyncStatus('failed');
      setSyncMessage(error instanceof Error ? `任务控制失败: ${error.message}` : '任务控制失败');
    }
  };

  const readErrorMessage = async (response: Response) => {
    try {
      const payload = await response.json();
      if (payload?.detail?.message) return payload.detail.message;
      if (typeof payload?.detail === 'string') return payload.detail;
      if (payload?.detail) return JSON.stringify(payload.detail);
      return `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  };

  const handleThemeChange = async (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    setSettingsMessage('');

    try {
      const response = await fetch('/api/v1/settings/appearance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: nextTheme }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
    } catch (error) {
      setSettingsMessage(error instanceof Error ? `主题保存失败: ${error.message}` : '主题保存失败');
    }
  };

  const openDataSyncDialog = () => {
    if (isSyncActive) return;
    setIsSyncDialogOpen(true);
  };

  const handleConfirmDataSync = async () => {
    if (syncStartDate && syncEndDate && syncStartDate > syncEndDate) {
      setSyncMessage('日期范围无效：开始日期不能晚于结束日期。');
      return;
    }

    const limitValue = syncFullUniverse ? 10000 : Math.max(1, Math.min(10000, Math.floor(Number(syncLimit) || 1)));

    setIsSyncDialogOpen(false);
    setSyncStatus('queued');
    setSyncMessage('任务已提交，正在自动刷新任务进度。');
    setFailedRows(0);
    setUpdatedRows(0);
    setTotalTasks(limitValue);
    setCompletedTasks(0);
    setProgressPercent(0);

    try {
      const response = await fetch('/api/v1/data-sync/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'akshare',
          scopes: syncUpdateMode === 'full'
            ? ['stock_basic', 'daily_prices', 'fundamentals']
            : ['daily_prices'],
          markets: ['A'],
          limit: limitValue,
          updateMode: syncUpdateMode,
          fullRefresh: syncUpdateMode === 'full',
          fullUniverse: syncFullUniverse,
          startDate: syncStartDate || undefined,
          endDate: syncEndDate || undefined,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}${errorText ? ` ${errorText.slice(0, 80)}` : ''}`);
      }

      const job = await response.json() as DataSyncJob;
      setSyncJobId(job.jobId);
      applySyncJob(job);
      setSyncMessage(`任务已提交，正在自动刷新；本次预计 ${job.totalTasks ?? limitValue} 个任务，日期 ${syncStartDate || '不限'} 至 ${syncEndDate || '不限'}。`);
      void refreshJobStatus(job.jobId, { suppressError: true });
    } catch (error) {
      setSyncStatus('failed');
      setSyncMessage(error instanceof Error ? `任务提交失败: ${error.message}` : '任务提交失败');
    }
  };

  const syncNoticeTitle = (() => {
    if (syncStatus === 'queued') return '更新任务已提交';
    if (syncStatus === 'running') return '正在更新选股器数据';
    if (syncStatus === 'paused') return '数据更新已暂停';
    if (syncStatus === 'stopped') return '数据更新已停止';
    if (syncStatus === 'success') return '选股器数据已更新';
    if (syncStatus === 'failed') return '数据更新失败';
    return '数据同步待命';
  })();

  return (
    <>
    <div className="max-w-7xl mx-auto space-y-12">
      {/* Page Header */}
      <div className="flex flex-col gap-3">
        <h1 className="text-5xl font-[800] font-headline text-primary tracking-tighter">设置</h1>
        <p className="font-medium text-on-surface-variant max-w-xl text-lg">
          管理您的金融终端偏好、外观以及选股器数据更新。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-12 flex flex-col gap-10">
          <section className="bg-surface-container-lowest rounded-[2rem] p-10 shadow-sm border border-outline-variant/10">
            <h2 className="text-2xl font-[800] font-headline text-primary mb-8 flex items-center gap-3">
              <Palette className="text-primary" size={24} />
              外观体验
            </h2>
            <p className="text-sm font-medium text-on-surface-variant mb-10 leading-relaxed">
              根据您的工作习惯选择最舒适的界面视觉呈现。高动态范围支持与色弱优化已默认开启。
            </p>

            <div className="grid grid-cols-3 gap-6">
                {themes.map((t) => (
                  <button 
                  type="button"
                  key={t.id}
                  onClick={() => void handleThemeChange(t.id)}
                  className="flex flex-col items-center gap-4 group cursor-pointer outline-none"
                >
                  <div className={cn(
                    "w-full aspect-[4/3] rounded-2xl transition-all duration-300 relative sm:p-2.5 p-1.5",
                    "border-2 flex flex-col overflow-hidden",
                    theme === t.id 
                      ? "border-primary shadow-lg shadow-primary/5 bg-surface-container-low" 
                      : "border-transparent bg-surface-container-highest/30 hover:border-outline-variant/50"
                  )}>
                    {t.id === 'light' && (
                      <div className="w-full h-full flex flex-col gap-1 sm:gap-2">
                        <div className="h-1/5 bg-surface-container-highest rounded-md" />
                        <div className="flex-1 flex gap-2">
                          <div className="w-1/4 h-full bg-surface-container-highest rounded-md" />
                          <div className="flex-1 h-full bg-surface rounded-md" />
                        </div>
                      </div>
                    )}
                    {t.id === 'dark' && (
                      <div className="w-full h-full flex flex-col gap-1 sm:gap-2">
                        <div className="h-1/5 bg-on-surface rounded-md" />
                        <div className="flex-1 flex gap-2">
                          <div className="w-1/4 h-full bg-on-surface-variant/20 rounded-md" />
                          <div className="flex-1 h-full bg-on-surface/80 rounded-md" />
                        </div>
                      </div>
                    )}

                    {theme === t.id && (
                      <div className="absolute bottom-2 right-2 w-6 h-6 bg-tertiary-fixed text-primary rounded-full flex items-center justify-center shadow-md animate-in zoom-in-50 duration-300">
                        <Check size={14} className="stroke-[4px]" />
                      </div>
                    )}
                  </div>
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-widest transition-colors",
                    theme === t.id ? "text-primary" : "text-on-surface-variant"
                  )}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
            {settingsMessage && (
              <p className="mt-6 text-xs font-bold text-on-surface-variant">{settingsMessage}</p>
            )}
          </section>

          <section className="bg-surface-container-lowest rounded-[2rem] p-10 shadow-sm border border-outline-variant/10">
            <div className="flex items-start justify-between gap-6 mb-8">
              <div>
                <h2 className="text-2xl font-[800] font-headline text-primary mb-3 flex items-center gap-3">
                  <Database className="text-primary" size={24} />
                  数据更新
                </h2>
                <p className="text-sm font-medium text-on-surface-variant leading-relaxed">
                  触发后端 AkShare 采集任务，更新股票基础信息、基本面指标和日线行情，供高级选股器使用。
                </p>
              </div>
              <div className={cn(
                "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap",
                syncStatus === 'success' && "bg-error-container/30 text-error",
                (syncStatus === 'failed' || syncStatus === 'stopped') && "bg-tertiary-container/10 text-tertiary-container",
                syncStatus === 'paused' && "bg-surface-container-highest text-primary",
                isSyncing && "bg-tertiary-fixed text-primary",
                syncStatus === 'idle' && "bg-surface-container-highest text-on-surface-variant"
              )}>
                {syncStatus === 'idle' && 'Standby'}
                {syncStatus === 'queued' && 'Queued'}
                {syncStatus === 'running' && 'Running'}
                {syncStatus === 'paused' && 'Paused'}
                {syncStatus === 'stopped' && 'Stopped'}
                {syncStatus === 'success' && 'Updated'}
                {syncStatus === 'failed' && 'Failed'}
              </div>
            </div>

            {syncStatus !== 'idle' && (
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  "rounded-2xl p-5 mb-8 border flex items-start gap-3",
                  syncStatus === 'success' && "bg-error-container/20 border-error-container/40 text-error",
                  (syncStatus === 'failed' || syncStatus === 'stopped') && "bg-tertiary-container/10 border-tertiary-container/20 text-tertiary-container",
                  syncStatus === 'paused' && "bg-surface-container-highest/60 border-outline-variant/20 text-primary",
                  isSyncing && "bg-tertiary-fixed/30 border-tertiary-fixed/70 text-primary"
                )}
              >
                {syncStatus === 'success' ? (
                  <Check size={20} className="mt-0.5 flex-shrink-0 stroke-[3px]" />
                ) : syncStatus === 'failed' || syncStatus === 'stopped' ? (
                  <AlertCircle size={20} className="mt-0.5 flex-shrink-0 stroke-[3px]" />
                ) : syncStatus === 'paused' ? (
                  <Pause size={20} className="mt-0.5 flex-shrink-0 stroke-[3px]" />
                ) : (
                  <RefreshCw size={20} className="mt-0.5 flex-shrink-0 animate-spin stroke-[3px]" />
                )}
                <div>
                  <p className="font-headline font-[900] text-base leading-none">{syncNoticeTitle}</p>
                  <p className="text-xs font-bold mt-2 leading-relaxed">{syncMessage}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
              <div className="bg-surface-container-low rounded-2xl p-4">
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2">数据源</p>
                <p className="font-headline font-[800] text-primary">AkShare</p>
              </div>
              <div className="bg-surface-container-low rounded-2xl p-4">
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2">最近同步</p>
                <p className="font-headline font-[800] text-primary tabular-nums">{lastSyncAt}</p>
              </div>
              <div className="bg-surface-container-low rounded-2xl p-4">
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2">更新记录</p>
                <p className="font-headline font-[800] text-primary tabular-nums">{updatedRows.toLocaleString()}</p>
              </div>
              <div className="bg-surface-container-low rounded-2xl p-4">
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2">当前进度</p>
                <p className="font-headline font-[800] text-primary tabular-nums">
                  {syncStatus === 'success' ? '已完成' : syncStatus === 'stopped' ? '已停止' : `${progressPercent}%`}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <div className="bg-surface-container-low rounded-2xl p-4">
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2">已有股票</p>
                <p className="font-headline font-[800] text-primary tabular-nums">
                  {(stockBasicDataset?.stockCount ?? stockBasicDataset?.rows ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="bg-surface-container-low rounded-2xl p-4">
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2">行情日期</p>
                <p className="font-headline font-[800] text-primary text-sm tabular-nums leading-snug">{currentDataRange}</p>
              </div>
              <div className="bg-surface-container-low rounded-2xl p-4">
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2">日线记录</p>
                <p className="font-headline font-[800] text-primary tabular-nums">
                  {(dailyPricesDataset?.rows ?? 0).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="bg-surface-container-highest/50 rounded-2xl p-5 mb-8 border border-outline-variant/10">
              <div className={cn(
                "flex items-start gap-3 text-sm font-bold",
                (syncStatus === 'failed' || syncStatus === 'stopped') ? "text-tertiary-container" : "text-on-surface-variant"
              )}>
                {syncStatus === 'failed' || syncStatus === 'stopped' ? (
                  <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
                ) : syncStatus === 'paused' ? (
                  <Pause size={18} className="mt-0.5 flex-shrink-0 text-primary" />
                ) : (
                  <Activity size={18} className="mt-0.5 flex-shrink-0 text-primary" />
                )}
                <div>
                  <p>{syncMessage}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest mt-2 opacity-70">
                    范围: {syncUpdateMode === 'full' ? '基础信息 / 基本面 / 日线行情' : '日线行情'} · 日期 {syncStartDate || '不限'} 至 {syncEndDate || '不限'}
                    {totalTasks > 0 && ` · 任务 ${completedTasks.toLocaleString()}/${totalTasks.toLocaleString()}`}
                    {failedRows > 0 && ` · 失败 ${failedRows.toLocaleString()} 条`}
                    {` · 状态源 ${syncIsRealtime ? '实时' : '历史'} · 后端 ${syncBackend === 'redis' ? 'Redis' : 'SQLite 回退'}`}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={openDataSyncDialog}
                disabled={isSyncActive}
                aria-busy={isSyncing}
                className={cn(
                  "flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-[800] font-headline text-base transition-all",
                  isSyncActive
                    ? "bg-surface-container-highest text-on-surface-variant cursor-not-allowed"
                    : "bg-primary text-surface shadow-xl shadow-primary/20 hover:scale-[1.01] active:scale-[0.98]"
                )}
              >
                <RefreshCw size={20} className={cn("stroke-[3px]", isSyncing && "animate-spin")} />
                {isSyncing ? '正在更新数据' : '更新选股器数据'}
              </button>
              <button
                type="button"
                onClick={() => void refreshJobStatus()}
                disabled={!syncJobId}
                data-feedback="正在刷新同步进度"
                className="flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-[800] font-headline text-base border border-outline-variant/20 text-primary hover:bg-surface-container-low transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Activity size={20} className="stroke-[3px]" />
                刷新进度
              </button>
            </div>
            {isSyncActive && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {syncStatus === 'paused' ? (
                  <button
                    type="button"
                    onClick={() => void handleSyncControl('resume')}
                    className="flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-[800] font-headline text-base border border-primary/30 text-primary hover:bg-tertiary-fixed/30 transition-all"
                  >
                    <Play size={20} className="stroke-[3px]" />
                    继续更新
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSyncControl('pause')}
                    className="flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-[800] font-headline text-base border border-outline-variant/20 text-primary hover:bg-surface-container-low transition-all"
                  >
                    <Pause size={20} className="stroke-[3px]" />
                    暂停更新
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSyncControl('stop')}
                  className="flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-[800] font-headline text-base border border-tertiary-container/30 text-tertiary-container hover:bg-tertiary-container/10 transition-all"
                >
                  <Square size={20} className="stroke-[3px]" />
                  停止更新
                </button>
              </div>
            )}
          </section>
        </div>

      </div>
    </div>

    {isSyncDialogOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 px-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="sync-dialog-title" className="w-full max-w-md rounded-3xl bg-surface-container-lowest p-5 shadow-2xl border border-outline-variant/20">
          <div className="mb-5">
            <p className="text-[10px] font-black text-secondary uppercase tracking-[0.18em] mb-1.5">AkShare Sync</p>
            <h2 id="sync-dialog-title" className="text-2xl font-[900] font-headline text-primary tracking-tight">
              确认更新参数
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.18em]">日期范围</p>
                <p className="text-[10px] font-bold text-on-surface-variant tabular-nums">
                  已有: {currentDataRange}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="sr-only">开始日期</span>
                  <input
                    type="date"
                    value={syncStartDate}
                    onChange={(event) => setSyncStartDate(event.target.value)}
                    className="w-full bg-surface-container-low border-b-2 border-outline/20 focus:border-primary px-3 py-2.5 text-xs font-black text-primary outline-none transition-all rounded-t-2xl tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">结束日期</span>
                  <input
                    type="date"
                    value={syncEndDate}
                    onChange={(event) => setSyncEndDate(event.target.value)}
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
                      const range = getDateRangePreset(preset.id);
                      setSyncStartDate(range.startDate);
                      setSyncEndDate(range.endDate);
                    }}
                    className="rounded-xl border border-outline-variant/20 px-2 py-1.5 text-[10px] font-black text-primary transition-colors hover:bg-surface-container-low"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.25fr] gap-3">
              <label className="block">
                <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.18em] block mb-2">更新数量</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={syncLimit}
                  onChange={(event) => setSyncLimit(event.target.value)}
                  disabled={syncFullUniverse}
                  className="w-full bg-surface-container-low border-b-2 border-outline/20 focus:border-primary px-4 py-3 text-sm font-black text-primary outline-none transition-all rounded-t-2xl text-right tabular-nums"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  setSyncFullUniverse(!syncFullUniverse);
                  if (!syncFullUniverse) {
                    setSyncLimit('10000');
                    setSyncUpdateMode('full');
                  }
                }}
                className={cn(
                  "mt-0 sm:mt-5 flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition-all",
                  syncFullUniverse
                    ? "border-primary bg-tertiary-fixed/40 text-primary"
                    : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:border-primary/40"
                )}
              >
                <span>
                  <span className="block font-headline font-[900] text-sm">A 股全量数据</span>
                  <span className="block text-[10px] font-bold mt-1 leading-snug">覆盖全部上市公司，任务上限 10000</span>
                </span>
                <span className={cn(
                  "h-5 w-9 rounded-full p-0.5 transition-colors",
                  syncFullUniverse ? "bg-primary" : "bg-outline-variant/40"
                )}>
                  <span className={cn(
                    "block h-4 w-4 rounded-full bg-surface transition-transform",
                    syncFullUniverse && "translate-x-4"
                  )} />
                </span>
              </button>
            </div>

            <div>
              <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.18em] mb-2">更新方式</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'full' as const, label: '全量更新', description: '同步 stock_basic、daily_prices、fundamentals' },
                  { id: 'price_only' as const, label: '仅更新现价', description: '只同步 daily_prices，并刷新价格信号' },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => setSyncUpdateMode(option.id)}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition-all",
                      syncUpdateMode === option.id
                        ? "border-primary bg-tertiary-fixed/40 text-primary"
                        : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:border-primary/40"
                    )}
                  >
                    <span className="block font-headline font-[900] text-sm">{option.label}</span>
                    <span className="block text-[10px] font-bold mt-1 leading-snug">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-surface-container-low p-3">
              <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.18em] mb-2">后台任务属性</p>
              <div className="space-y-1.5">
                {dataSyncScopeDescriptions.map((scope) => (
                  <div key={scope.id} className="text-[11px] font-bold leading-snug">
                    <span className="font-black text-primary">{scope.label}</span>
                    <span className="text-on-surface-variant">: {scope.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsSyncDialogOpen(false)}
              className="px-4 py-2.5 rounded-2xl font-[800] text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirmDataSync}
              className="px-6 py-2.5 rounded-2xl font-[900] font-headline text-sm bg-primary text-surface shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              确认
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};
