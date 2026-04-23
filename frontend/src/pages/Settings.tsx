import React, { useEffect, useState } from 'react';
import { 
  Palette, 
  Cpu, 
  Eye, 
  EyeOff, 
  Check, 
  Sun, 
  Moon, 
  Monitor,
  Save,
  MemoryStick,
  Database,
  RefreshCw,
  Activity,
  AlertCircle,
  Plus,
  Trash2
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

type DataSyncStatus = 'idle' | 'queued' | 'running' | 'success' | 'failed';
type DataSyncUpdateMode = 'full' | 'price_only';
type LlmProvider = string;

interface DataSyncJob {
  jobId: string;
  status: Exclude<DataSyncStatus, 'idle'>;
  limit?: number;
  updateMode?: DataSyncUpdateMode;
  totalTasks?: number;
  completedTasks?: number;
  progressPercent?: number;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedRows?: number;
  failedRows?: number;
}

interface SettingsResponse {
  appearance: {
    theme: 'light' | 'dark' | 'system';
  };
  llm: {
    provider: LlmProvider;
    model: string;
    baseUrl?: string | null;
    hasApiKey: boolean;
    clusterStatus: string;
    latencyMs: number;
  };
  llmModels?: {
    items?: LlmModelItem[];
  };
}

interface LlmModelItem {
  id: number;
  provider: LlmProvider;
  model: string;
  baseUrl?: string | null;
  hasApiKey: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const Settings: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [provider, setProvider] = useState<LlmProvider>('openai');
  const [model, setModel] = useState('gpt-4o');
  const [baseUrl, setBaseUrl] = useState('');
  const [llmModels, setLlmModels] = useState<LlmModelItem[]>([]);
  const [newModelProvider, setNewModelProvider] = useState<LlmProvider>('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelBaseUrl, setNewModelBaseUrl] = useState('');
  const [newModelApiKey, setNewModelApiKey] = useState('');
  const [showNewModelKey, setShowNewModelKey] = useState(false);
  const [modelApiKeys, setModelApiKeys] = useState<Record<number, string>>({});
  const [visibleModelKeys, setVisibleModelKeys] = useState<Record<number, boolean>>({});
  const [clusterStatus, setClusterStatus] = useState('normal');
  const [latencyMs, setLatencyMs] = useState<number | null>(1.2);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [isSavingLlm, setIsSavingLlm] = useState(false);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [isAddingLlm, setIsAddingLlm] = useState(false);
  const [testingModelId, setTestingModelId] = useState<number | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<DataSyncStatus>('idle');
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('等待首次同步');
  const [lastSyncAt, setLastSyncAt] = useState('尚未同步');
  const [updatedRows, setUpdatedRows] = useState(0);
  const [failedRows, setFailedRows] = useState(0);
  const [syncLimit, setSyncLimit] = useState('300');
  const [syncUpdateMode, setSyncUpdateMode] = useState<DataSyncUpdateMode>('full');
  const [totalTasks, setTotalTasks] = useState(0);
  const [completedTasks, setCompletedTasks] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);

  const themes = [
    { id: 'light', label: '浅色模式', icon: Sun },
    { id: 'dark', label: '深色模式', icon: Moon },
    { id: 'system', label: '跟随系统', icon: Monitor },
  ] as const;

  const isSyncing = syncStatus === 'queued' || syncStatus === 'running';
  const canDeleteLlmModel = llmModels.length > 1;
  const activeModel = llmModels.find((item) => item.isActive);

  const getProviderLabel = (value: string) => {
    return value || 'Custom';
  };

  const applySyncJob = (job: DataSyncJob) => {
    setSyncStatus(job.status === 'success' ? 'success' : job.status === 'failed' ? 'failed' : job.status);
    setSyncMessage(job.message ?? (job.status === 'success' ? '已完成' : 'AkShare 数据任务处理中'));
    setTotalTasks(job.totalTasks ?? 0);
    setCompletedTasks(job.completedTasks ?? 0);
    setProgressPercent(job.progressPercent ?? 0);
    setUpdatedRows(job.updatedRows ?? 0);
    setFailedRows(job.failedRows ?? 0);
    if (job.limit) setSyncLimit(String(job.limit));
    if (job.updateMode) setSyncUpdateMode(job.updateMode);
    if (job.status === 'success') {
      window.dispatchEvent(new CustomEvent('midas:data-sync-updated'));
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
        setProvider(payload.llm.provider);
        setModel(payload.llm.model);
        setBaseUrl(payload.llm.baseUrl ?? '');
        setHasApiKey(Boolean(payload.llm.hasApiKey));
        setLlmModels(payload.llmModels?.items ?? []);
        setClusterStatus(payload.llm.clusterStatus ?? 'normal');
        setLatencyMs(typeof payload.llm.latencyMs === 'number' ? payload.llm.latencyMs : null);
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

  const refreshJobStatus = async (jobId = syncJobId) => {
    if (!jobId) return;

    try {
      const response = await fetch(`/api/v1/data-sync/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const job = await response.json() as DataSyncJob;
      applySyncJob(job);
    } catch (error) {
      setSyncStatus('failed');
      setSyncMessage(error instanceof Error ? `状态查询失败: ${error.message}` : '状态查询失败');
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

  const loadLlmModels = async () => {
    const response = await fetch('/api/v1/settings/llm/models');
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = await response.json() as { items?: LlmModelItem[] };
    setLlmModels(payload.items ?? []);
  };

  const handleThemeChange = async (nextTheme: 'light' | 'dark' | 'system') => {
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

  const handleTestConnection = async () => {
    setIsTestingLlm(true);
    setSettingsMessage('正在测试连接...');

    try {
      const response = await fetch('/api/v1/settings/llm/test', { method: 'POST' });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.detail?.message ?? `HTTP ${response.status}`);
      }

      setLatencyMs(typeof payload.latencyMs === 'number' ? payload.latencyMs : null);
      setSettingsMessage(payload.message ?? '连接正常');
    } catch (error) {
      setSettingsMessage(error instanceof Error ? `连接测试失败: ${error.message}` : '连接测试失败');
    } finally {
      setIsTestingLlm(false);
    }
  };

  const activateLlmModel = async (item: LlmModelItem, nextApiKey?: string) => {
    const response = await fetch('/api/v1/settings/llm', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: item.provider,
        model: item.model,
        baseUrl: item.baseUrl || undefined,
        apiKey: nextApiKey?.trim() || undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = await response.json() as { hasApiKey: boolean };
    setProvider(item.provider);
    setModel(item.model);
    setBaseUrl(item.baseUrl ?? '');
    setHasApiKey(Boolean(payload.hasApiKey));
    setLlmModels((items) => items.map((modelItem) => ({
      ...modelItem,
      hasApiKey: modelItem.id === item.id ? Boolean(payload.hasApiKey) : modelItem.hasApiKey,
      isActive: modelItem.id === item.id,
    })));
  };

  const handleActivateModel = async (item: LlmModelItem) => {
    setSettingsMessage(`正在切换到 ${item.model}...`);

    try {
      await activateLlmModel(item, modelApiKeys[item.id]);
      setSettingsMessage(`当前模型已切换为 ${item.model}`);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? `切换失败: ${error.message}` : '切换失败');
    }
  };

  const handleTestModel = async (item: LlmModelItem) => {
    setTestingModelId(item.id);
    setSettingsMessage(`正在测试 ${item.model}...`);

    try {
      await activateLlmModel(item, modelApiKeys[item.id]);

      const response = await fetch('/api/v1/settings/llm/test', { method: 'POST' });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.detail?.message ?? `HTTP ${response.status}`);
      }

      setLatencyMs(typeof payload.latencyMs === 'number' ? payload.latencyMs : null);
      setSettingsMessage(`${item.model}: ${payload.message ?? '连接正常'}`);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? `${item.model} 测试失败: ${error.message}` : `${item.model} 测试失败`);
    } finally {
      setTestingModelId(null);
    }
  };

  const handleAddLlmModel = async () => {
    const normalizedModel = newModelName.trim();
    const normalizedProvider = newModelProvider.trim();
    if (!normalizedProvider || !normalizedModel) {
      setSettingsMessage('请输入配置名称和模型名称');
      return;
    }

    setIsAddingLlm(true);
    setSettingsMessage('正在增加模型...');

    try {
      const response = await fetch('/api/v1/settings/llm/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: newModelProvider,
          baseUrl: newModelBaseUrl.trim() || undefined,
          model: normalizedModel,
          apiKey: newModelApiKey.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const created = await response.json() as LlmModelItem;
      setLlmModels((items) => [...items, created]);
      setNewModelProvider('');
      setNewModelName('');
      setNewModelBaseUrl('');
      setNewModelApiKey('');
      setSettingsMessage(`已增加模型 ${created.model}`);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? `增加模型失败: ${error.message}` : '增加模型失败');
    } finally {
      setIsAddingLlm(false);
    }
  };

  const handleDeleteLlmModel = async (item: LlmModelItem) => {
    if (!canDeleteLlmModel) {
      setSettingsMessage('至少保留一个 LLM 模型配置');
      return;
    }

    const confirmed = window.confirm(`删除 ${getProviderLabel(item.provider)} / ${item.model}？`);
    if (!confirmed) return;

    setDeletingModelId(item.id);
    setSettingsMessage(`正在删除 ${item.model}...`);

    try {
      const response = await fetch(`/api/v1/settings/llm/models/${item.id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      await loadLlmModels();
      if (item.isActive) {
        const settingsResponse = await fetch('/api/v1/settings');
        if (settingsResponse.ok) {
          const payload = await settingsResponse.json() as SettingsResponse;
          setProvider(payload.llm.provider);
          setModel(payload.llm.model);
          setBaseUrl(payload.llm.baseUrl ?? '');
          setHasApiKey(Boolean(payload.llm.hasApiKey));
        }
      }
      setSettingsMessage(`已删除模型 ${item.model}`);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? `删除模型失败: ${error.message}` : '删除模型失败');
    } finally {
      setDeletingModelId(null);
    }
  };

  const handleSaveAndRestart = async () => {
    setIsSavingLlm(true);
    setSettingsMessage('正在保存并重启...');

    try {
      const saveResponse = await fetch('/api/v1/settings/llm', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          baseUrl: baseUrl.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      });

      if (!saveResponse.ok) {
        throw new Error(await readErrorMessage(saveResponse));
      }

      const saved = await saveResponse.json() as { hasApiKey: boolean };
      setHasApiKey(Boolean(saved.hasApiKey));
      await loadLlmModels();

      const restartResponse = await fetch('/api/v1/settings/llm/restart', { method: 'POST' });
      if (!restartResponse.ok) {
        throw new Error(await readErrorMessage(restartResponse));
      }

      const restarted = await restartResponse.json() as { clusterStatus?: string; latencyMs?: number };
      setClusterStatus(restarted.clusterStatus ?? 'normal');
      setLatencyMs(typeof restarted.latencyMs === 'number' ? restarted.latencyMs : null);
      setApiKey('');
      setSettingsMessage('保存并重启完成');
    } catch (error) {
      setSettingsMessage(error instanceof Error ? `保存失败: ${error.message}` : '保存失败');
    } finally {
      setIsSavingLlm(false);
    }
  };

  const handleDataSync = () => {
    if (isSyncing) return;
    setIsSyncDialogOpen(true);
  };

  const handleConfirmDataSync = async () => {
    const limitValue = Math.max(1, Math.min(10000, Math.floor(Number(syncLimit) || 1)));

    setIsSyncDialogOpen(false);
    setSyncStatus('queued');
    setSyncMessage('任务已提交，请等待约 10 秒后查看任务信息。');
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
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}${errorText ? ` ${errorText.slice(0, 80)}` : ''}`);
      }

      const job = await response.json() as DataSyncJob;
      setSyncJobId(job.jobId);
      applySyncJob(job);
      setSyncMessage(`任务已提交，请等待约 10 秒后查看任务信息；本次预计 ${job.totalTasks ?? limitValue} 个任务。`);
      window.setTimeout(() => {
        void refreshJobStatus(job.jobId);
      }, 10000);
    } catch (error) {
      setSyncStatus('failed');
      setSyncMessage(error instanceof Error ? `任务提交失败: ${error.message}` : '任务提交失败');
    }
  };

  const syncNoticeTitle = (() => {
    if (syncStatus === 'queued') return '更新任务已提交';
    if (syncStatus === 'running') return '正在更新选股器数据';
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
          管理您的金融终端偏好、外观以及 AI 模型推理配置。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left Column: Appearance */}
        <div className="lg:col-span-5 flex flex-col gap-10">
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
                    {t.id === 'system' && (
                      <div className="w-full h-full bg-gradient-to-br from-surface-container-highest to-on-surface rounded-md flex items-center justify-center">
                        <Monitor size={24} className="text-on-surface-variant/40" />
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
                syncStatus === 'failed' && "bg-tertiary-container/10 text-tertiary-container",
                isSyncing && "bg-tertiary-fixed text-primary",
                syncStatus === 'idle' && "bg-surface-container-highest text-on-surface-variant"
              )}>
                {syncStatus === 'idle' && 'Standby'}
                {syncStatus === 'queued' && 'Queued'}
                {syncStatus === 'running' && 'Running'}
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
                  syncStatus === 'failed' && "bg-tertiary-container/10 border-tertiary-container/20 text-tertiary-container",
                  isSyncing && "bg-tertiary-fixed/30 border-tertiary-fixed/70 text-primary"
                )}
              >
                {syncStatus === 'success' ? (
                  <Check size={20} className="mt-0.5 flex-shrink-0 stroke-[3px]" />
                ) : syncStatus === 'failed' ? (
                  <AlertCircle size={20} className="mt-0.5 flex-shrink-0 stroke-[3px]" />
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
                  {syncStatus === 'success' ? '已完成' : `${progressPercent}%`}
                </p>
              </div>
            </div>

            <div className="bg-surface-container-highest/50 rounded-2xl p-5 mb-8 border border-outline-variant/10">
              <div className={cn(
                "flex items-start gap-3 text-sm font-bold",
                syncStatus === 'failed' ? "text-tertiary-container" : "text-on-surface-variant"
              )}>
                {syncStatus === 'failed' ? <AlertCircle size={18} className="mt-0.5 flex-shrink-0" /> : <Activity size={18} className="mt-0.5 flex-shrink-0 text-primary" />}
                <div>
                  <p>{syncMessage}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest mt-2 opacity-70">
                    范围: A 股基础信息 / 基本面 / 开盘价 / 收盘价 / 成交量
                    {totalTasks > 0 && ` · 任务 ${completedTasks.toLocaleString()}/${totalTasks.toLocaleString()}`}
                    {failedRows > 0 && ` · 失败 ${failedRows.toLocaleString()} 条`}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleDataSync}
                disabled={isSyncing}
                aria-busy={isSyncing}
                className={cn(
                  "flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-[800] font-headline text-base transition-all",
                  isSyncing
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
          </section>
        </div>

        {/* Right Column: AI Config */}
        <div className="lg:col-span-7 flex flex-col gap-10">
          <section className="bg-surface-container-lowest rounded-[2rem] p-10 shadow-sm border border-outline-variant/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none group-hover:scale-125 transition-transform duration-1000" />
            
            <h2 className="text-2xl font-[800] font-headline text-primary mb-10 flex items-center gap-3">
              <Cpu className="text-primary" size={24} />
              LLM 模型集群配置
            </h2>

            <div className="space-y-10 relative">
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.9fr] gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] mb-2">
                        已配置模型
                      </p>
                      <h3 className="font-headline font-[900] text-xl text-primary">
                        {activeModel ? `${getProviderLabel(activeModel.provider)} / ${activeModel.model}` : `${getProviderLabel(provider)} / ${model}`}
                      </h3>
                    </div>
                    <div className="rounded-full bg-tertiary-fixed/50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                      {llmModels.length} Models
                    </div>
                  </div>

                  <div className="space-y-3">
                    {llmModels.length === 0 && (
                      <div className="rounded-2xl bg-surface-container-highest/50 p-5 text-sm font-bold text-on-surface-variant">
                        正在加载模型配置...
                      </div>
                    )}
                    {llmModels.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-2xl border p-5 transition-all",
                          item.isActive
                            ? "border-primary/40 bg-tertiary-fixed/30"
                            : "border-outline-variant/15 bg-surface-container-highest/40 hover:border-primary/30"
                        )}
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-headline font-[900] text-lg text-primary break-all">{item.model}</h4>
                              {item.isActive && (
                                <span className="rounded-full bg-primary px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-surface">
                                  Active
                                </span>
                              )}
                              {item.hasApiKey && (
                                <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-on-surface-variant">
                                  Key
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-on-surface-variant">
                              {getProviderLabel(item.provider)}
                            </p>
                            <p className="mt-2 text-xs font-bold text-on-surface-variant break-all">
                              {item.baseUrl || '使用后端默认 API 地址'}
                            </p>
                          </div>

                          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
                            <button
                              type="button"
                              onClick={() => void handleActivateModel(item)}
                              disabled={item.isActive || isSavingLlm || testingModelId !== null || deletingModelId !== null}
                              className="rounded-xl border border-outline-variant/20 px-3 py-2 text-[10px] font-black text-primary transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              设为当前
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleTestModel(item)}
                              disabled={isSavingLlm || testingModelId !== null || deletingModelId !== null}
                              className="rounded-xl border border-outline-variant/20 px-3 py-2 text-[10px] font-black text-primary transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {testingModelId === item.id ? '测试中' : '测试'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteLlmModel(item)}
                              disabled={!canDeleteLlmModel || isSavingLlm || testingModelId !== null || deletingModelId !== null}
                              aria-label={`删除模型 ${item.model}`}
                              title={canDeleteLlmModel ? '删除模型' : '至少保留一个模型'}
                              className="flex items-center justify-center rounded-xl border border-outline-variant/20 px-3 py-2 text-tertiary-container transition-colors hover:bg-tertiary-container/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {deletingModelId === item.id ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            </button>
                          </div>
                        </div>
                        <div className="mt-4">
                          <label className="block">
                            <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                              API Key
                            </span>
                            <div className="relative">
                              <input
                                type={visibleModelKeys[item.id] ? "text" : "password"}
                                value={modelApiKeys[item.id] ?? ''}
                                onChange={(event) => setModelApiKeys((values) => ({ ...values, [item.id]: event.target.value }))}
                                placeholder={item.hasApiKey ? '已配置 API Key（输入可覆盖）' : '输入后可测试或设为当前模型'}
                                className="w-full rounded-t-2xl border-b-2 border-outline/20 bg-surface-container-low px-4 py-3 pr-12 font-mono text-sm text-primary outline-none transition-all focus:border-primary"
                              />
                              <button
                                type="button"
                                aria-label={visibleModelKeys[item.id] ? "隐藏模型 API Key" : "显示模型 API Key"}
                                onClick={() => setVisibleModelKeys((values) => ({ ...values, [item.id]: !values[item.id] }))}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary"
                              >
                                {visibleModelKeys[item.id] ? <EyeOff size={18} /> : <Eye size={18} />}
                              </button>
                            </div>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-surface-container-highest/50 p-5 border border-outline-variant/10">
                  <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] mb-5">
                    新增模型
                  </p>
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-on-surface-variant">配置名称</span>
                      <input
                        value={newModelProvider}
                        onChange={(event) => setNewModelProvider(event.target.value)}
                        placeholder="openai-compatible / siliconflow / internal-gateway"
                        className="w-full rounded-t-2xl border-b-2 border-outline/20 bg-surface-container-low px-4 py-3 text-sm font-bold text-primary outline-none transition-all focus:border-primary"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Model</span>
                      <input
                        value={newModelName}
                        onChange={(event) => setNewModelName(event.target.value)}
                        placeholder="gpt-4o-mini"
                        className="w-full rounded-t-2xl border-b-2 border-outline/20 bg-surface-container-low px-4 py-3 text-sm font-bold text-primary outline-none transition-all focus:border-primary"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-on-surface-variant">API 地址</span>
                      <input
                        value={newModelBaseUrl}
                        onChange={(event) => setNewModelBaseUrl(event.target.value)}
                        placeholder="https://api.example.com/v1"
                        className="w-full rounded-t-2xl border-b-2 border-outline/20 bg-surface-container-low px-4 py-3 text-sm font-bold text-primary outline-none transition-all focus:border-primary"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-on-surface-variant">API Key</span>
                      <div className="relative">
                        <input
                          type={showNewModelKey ? "text" : "password"}
                          value={newModelApiKey}
                          onChange={(event) => setNewModelApiKey(event.target.value)}
                          placeholder="可选，留空则使用后端环境配置"
                          className="w-full rounded-t-2xl border-b-2 border-outline/20 bg-surface-container-low px-4 py-3 pr-12 font-mono text-sm text-primary outline-none transition-all focus:border-primary"
                        />
                        <button
                          type="button"
                          aria-label={showNewModelKey ? "隐藏新增模型 API Key" : "显示新增模型 API Key"}
                          onClick={() => setShowNewModelKey(!showNewModelKey)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary"
                        >
                          {showNewModelKey ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </label>

                    <button
                      type="button"
                      onClick={() => void handleAddLlmModel()}
                      disabled={isAddingLlm || !newModelProvider.trim() || !newModelName.trim()}
                      className="flex w-full items-center justify-center gap-3 rounded-2xl bg-primary px-6 py-4 font-headline text-base font-[900] text-surface shadow-xl shadow-primary/20 transition-all hover:scale-[1.01] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAddingLlm ? <RefreshCw size={20} className="animate-spin stroke-[3px]" /> : <Plus size={20} className="stroke-[3px]" />}
                      增加模型
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] mb-4">
                  当前模型 API Key
                </label>
                <div className="relative flex items-center group">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={hasApiKey ? "已配置 API Key（输入可覆盖）" : "留空则使用后端环境配置"}
                    className="w-full bg-surface-container-highest/50 border-b-2 border-outline/20 outline-none rounded-t-2xl px-5 py-4 font-mono text-sm text-primary focus:border-primary transition-all pr-14"
                  />
                  <button
                    type="button"
                    aria-label={showKey ? "隐藏 API 密钥" : "显示 API 密钥"}
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-5 p-1 text-on-surface-variant hover:text-primary transition-colors outline-none"
                  >
                    {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-[10px] font-medium text-on-surface-variant/60 mt-3 px-1 italic">
                  * 仅更新当前模型 {getProviderLabel(provider)} / {model} 的运行时密钥。
                </p>
              </div>

              <div className="pt-10 border-t border-surface-container flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3 text-tertiary-container">
                    <MemoryStick size={16} />
                    <span className="text-[10px] font-black uppercase tracking-widest leading-none">
                      推理集群负载: {clusterStatus === 'normal' ? '正常' : clusterStatus}
                      {latencyMs !== null && ` (${latencyMs}ms latency)`}
                    </span>
                  </div>
                  {settingsMessage && (
                    <p className="text-xs font-bold text-on-surface-variant">{settingsMessage}</p>
                  )}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={isTestingLlm || isSavingLlm}
                    className="flex items-center justify-center gap-3 px-8 py-4 border border-outline-variant/20 text-primary rounded-2xl font-[800] font-headline text-base hover:bg-surface-container-low active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <Check size={20} className="stroke-[3px]" />
                    {isTestingLlm ? '测试中' : '测试连接'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveAndRestart()}
                    disabled={isSavingLlm || isTestingLlm}
                    className="flex items-center justify-center gap-3 px-10 py-4 bg-primary text-surface rounded-2xl font-[800] font-headline text-base shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <Save size={20} className="stroke-[3px]" />
                    {isSavingLlm ? '保存中' : '保存并重启集群'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    {isSyncDialogOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 px-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="sync-dialog-title" className="w-full max-w-lg rounded-[2rem] bg-surface-container-lowest p-8 shadow-2xl border border-outline-variant/20">
          <div className="mb-8">
            <p className="text-[10px] font-black text-secondary uppercase tracking-[0.18em] mb-3">AkShare Sync</p>
            <h2 id="sync-dialog-title" className="text-3xl font-[900] font-headline text-primary tracking-tight">
              确认更新参数
            </h2>
          </div>

          <div className="space-y-7">
            <label className="block">
              <span className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.18em] block mb-3">Limit</span>
              <input
                type="number"
                min={1}
                max={10000}
                value={syncLimit}
                onChange={(event) => setSyncLimit(event.target.value)}
                className="w-full bg-surface-container-low border-b-2 border-outline/20 focus:border-primary px-5 py-4 text-base font-black text-primary outline-none transition-all rounded-t-2xl text-right tabular-nums"
              />
            </label>

            <div>
              <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.18em] mb-3">更新方式</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'full' as const, label: '全量更新', description: '基础信息、基本面、日线行情' },
                  { id: 'price_only' as const, label: '仅更新现价', description: '保留 MA120，仅刷新最新价格' },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => setSyncUpdateMode(option.id)}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition-all",
                      syncUpdateMode === option.id
                        ? "border-primary bg-tertiary-fixed/40 text-primary"
                        : "border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:border-primary/40"
                    )}
                  >
                    <span className="block font-headline font-[900] text-base">{option.label}</span>
                    <span className="block text-[10px] font-bold mt-2 leading-relaxed">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsSyncDialogOpen(false)}
              className="px-6 py-3 rounded-2xl font-[800] text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirmDataSync}
              className="px-8 py-3 rounded-2xl font-[900] font-headline text-sm bg-primary text-surface shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
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
