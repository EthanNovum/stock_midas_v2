import React, { useEffect, useMemo, useState } from 'react';
import {
  Building,
  Calendar,
  ChevronRight,
  CircleMinus,
  CircleX,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  Trophy,
  Upload,
  X
} from 'lucide-react';
import { StockKlineChart } from '@/src/components/StockKlineChart';
import { cn } from '@/src/lib/utils';
import { Rating, StockRef } from '@/src/types';

type ReportVerdict = 'win' | 'loss' | 'flat';

interface ReportStock {
  symbol: string;
  name: string | null;
  verdict: ReportVerdict;
}

interface KlinePoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

interface KlineSeries {
  symbol: string;
  name: string;
  verdict: ReportVerdict;
  klineData: KlinePoint[];
  startClose: number | null;
  latestClose: number | null;
  changePct: number | null;
}

interface ResearchReportListItem {
  id: string;
  title: string;
  ticker: string;
  tickerName: string;
  rating: Rating;
  institution: string;
  date: string;
  stocks: ReportStock[];
  sourceUrl?: string | null;
  sourceFileName?: string | null;
}

interface ResearchReportDetail extends ResearchReportListItem {
  content: string;
  sourceFileMime?: string | null;
  klineSeries: KlineSeries[];
  klineData: KlinePoint[];
}

interface InstitutionRanking {
  institution: string;
  reportCount: number;
  stockMentions: number;
  wins: number;
  winRate: number;
}

interface InstitutionEditorState {
  originalName: string;
  name: string;
}

interface InstitutionCreateState {
  name: string;
}

interface SearchResultItem {
  type: string;
  id: string;
  title: string;
  subtitle: string;
}

interface ReportFormState {
  title: string;
  institution: string;
  rating: Rating;
  date: string;
  content: string;
  sourceUrl: string;
}

interface UploadedFileState {
  name: string;
  mime: string;
  content: string;
}

interface ReportsProps {
  stockFilter: StockRef | null;
  onClearStockFilter: () => void;
  onOpenStockDetail: (stock: StockRef) => void;
}

const getTodayDateValue = () => {
  const date = new Date();
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
};

const createEmptyForm = (): ReportFormState => ({
  title: '',
  institution: '',
  rating: 'buy',
  date: getTodayDateValue(),
  content: '',
  sourceUrl: '',
});

const ratingLabels: Record<Rating, string> = { buy: '买入', hold: '维持', sell: '卖出' };

const verdictMeta = {
  win: {
    label: '胜利',
    Icon: Trophy,
    className: 'bg-error-container/30 text-error border-error-container/40',
  },
  loss: {
    label: '失败',
    Icon: CircleX,
    className: 'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/30',
  },
  flat: {
    label: '持平',
    Icon: CircleMinus,
    className: 'bg-surface-container-highest text-on-surface-variant border-outline-variant/20',
  },
} satisfies Record<ReportVerdict, { label: string; Icon: typeof Trophy; className: string }>;

const readErrorMessage = async (response: Response) => {
  try {
    const payload = await response.json();
    return payload.detail || `请求失败：${response.status}`;
  } catch {
    return `请求失败：${response.status}`;
  }
};

const formatPercent = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const formatPrice = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return value.toFixed(2);
};

const changeColorClass = (value: number | null | undefined) => (
  (value ?? 0) >= 0 ? 'text-error' : 'text-tertiary-container'
);

const RatingBadge: React.FC<{ rating: Rating }> = ({ rating }) => {
  const styles = {
    buy: 'bg-error-container/20 text-error border-error-container/30',
    hold: 'bg-surface-container-highest text-on-surface-variant border-surface-container-highest',
    sell: 'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20'
  };

  return (
    <span className={cn('px-3 py-1 rounded-md text-xs font-black border', styles[rating])}>
      {ratingLabels[rating]}
    </span>
  );
};

const VerdictIcon: React.FC<{ verdict: ReportVerdict; label?: string; compact?: boolean }> = ({ verdict, label, compact = false }) => {
  const meta = verdictMeta[verdict];
  const Icon = meta.Icon;
  return (
    <span
      title={label ? `${label}：${meta.label}` : meta.label}
      className={cn(
        'inline-flex items-center justify-center border font-black',
        compact ? 'h-7 w-7 rounded-lg' : 'h-8 px-2.5 gap-1.5 rounded-xl text-[10px]',
        meta.className
      )}
    >
      <Icon size={compact ? 14 : 15} strokeWidth={3} />
      {!compact && <span>{meta.label}</span>}
    </span>
  );
};

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

const KlineChart: React.FC<{ series: KlineSeries | null }> = ({ series }) => {
  const data = useMemo(() => (series?.klineData ?? []), [series]);
  const rangeStats = useMemo(() => {
    if (!series || data.length === 0) return null;
    const firstPoint = data[0];
    const latestPoint = data[data.length - 1];
    const highPoint = data.reduce((current, point) => (point.high > current.high ? point : current), firstPoint);
    const lowPoint = data.reduce((current, point) => (point.low < current.low ? point : current), firstPoint);
    const startClose = series.startClose ?? firstPoint.close;
    const latestClose = series.latestClose ?? latestPoint.close;
    const changePct = series.changePct ?? (startClose ? ((latestClose - startClose) / startClose) * 100 : null);

    let peak = data[0].close;
    let maxDrawdown = 0;
    for (const point of data) {
      if (point.close > peak) peak = point.close;
      const drawdown = peak ? (peak - point.close) / peak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return {
      firstPoint,
      latestPoint,
      highPoint,
      lowPoint,
      startClose,
      latestClose,
      changePct,
      maxDrawdownPct: maxDrawdown * 100,
    };
  }, [data, series]);

  if (!series || data.length === 0) {
    return (
      <div className="h-72 w-full rounded-2xl bg-surface-container-low flex items-center justify-center text-sm font-bold text-on-surface-variant">
        暂无该区间行情数据
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rangeStats && (
        <div className="grid grid-cols-1 gap-4 border-b border-outline-variant/20 pb-4 md:grid-cols-[1fr_auto] md:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h4 className="truncate text-2xl font-[900] font-headline text-primary">{series.name}</h4>
              <span className="font-mono text-sm font-black text-on-surface-variant">{series.symbol}</span>
              <VerdictIcon verdict={series.verdict ?? 'flat'} label={series.name} compact />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center md:max-w-xl md:grid-cols-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">起始收盘</p>
                <p className="mt-1 font-mono text-lg font-black text-primary">{formatPrice(rangeStats.startClose)}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">期间最高</p>
                <p className="mt-1 font-mono text-lg font-black text-error">{formatPrice(rangeStats.highPoint.high)}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">期间最低</p>
                <p className="mt-1 font-mono text-lg font-black text-tertiary-container">{formatPrice(rangeStats.lowPoint.low)}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">最大回撤</p>
                <p className="mt-1 font-mono text-lg font-black text-tertiary-container">-{Math.abs(rangeStats.maxDrawdownPct).toFixed(2)}%</p>
              </div>
            </div>
          </div>
          <div className="md:text-right">
            <p className="font-mono text-3xl font-[900] text-primary">{formatPrice(rangeStats.latestClose)}</p>
            <p className={cn('mt-1 font-mono text-2xl font-black', changeColorClass(rangeStats.changePct))}>
              {formatPercent(rangeStats.changePct)}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 text-sm font-bold text-on-surface-variant md:col-span-2 md:grid-cols-2">
            <p>{rangeStats.firstPoint.date}日收盘价: <span className="font-mono text-primary">{formatPrice(rangeStats.startClose)}</span></p>
            <p className="md:text-right">至 {rangeStats.latestPoint.date}: <span className={cn('font-mono', changeColorClass(rangeStats.changePct))}>{formatPercent(rangeStats.changePct)}</span></p>
          </div>
        </div>
      )}
      <StockKlineChart points={data} mode="kline" heightClassName="h-72" />
    </div>
  );
};

export const Reports: React.FC<ReportsProps> = ({ stockFilter, onClearStockFilter, onOpenStockDetail }) => {
  const [reports, setReports] = useState<ResearchReportListItem[]>([]);
  const [institutions, setInstitutions] = useState<string[]>([]);
  const [institutionRankings, setInstitutionRankings] = useState<InstitutionRanking[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ResearchReportDetail | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState('');
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [form, setForm] = useState<ReportFormState>(createEmptyForm);
  const [selectedStocks, setSelectedStocks] = useState<ReportStock[]>([]);
  const [stockInput, setStockInput] = useState('');
  const [stockSearchResults, setStockSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearchingStocks, setIsSearchingStocks] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFileState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingVerdictSymbol, setEditingVerdictSymbol] = useState<string | null>(null);
  const [isUpdatingVerdict, setIsUpdatingVerdict] = useState(false);
  const [editingInstitution, setEditingInstitution] = useState<InstitutionEditorState | null>(null);
  const [creatingInstitution, setCreatingInstitution] = useState<InstitutionCreateState | null>(null);
  const [deletingInstitution, setDeletingInstitution] = useState<InstitutionRanking | null>(null);
  const [deletingReport, setDeletingReport] = useState<ResearchReportDetail | null>(null);
  const [isMutatingInstitution, setIsMutatingInstitution] = useState(false);
  const [isDeletingReport, setIsDeletingReport] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reportFormError, setReportFormError] = useState<string | null>(null);

  const activeSeries = useMemo(() => {
    if (!selectedReport) return null;
    return selectedReport.klineSeries.find((series) => series.symbol === selectedSymbol) ?? selectedReport.klineSeries[0] ?? null;
  }, [selectedReport, selectedSymbol]);

  const stockFilterLabel = stockFilter
    ? `${stockFilter.name ? `${stockFilter.name} ` : ''}${stockFilter.symbol}`
    : '';
  const isEditOpen = editingReportId !== null;
  const isReportDialogOpen = isCreateOpen || isEditOpen;

  const loadReports = async (preferredReportId?: string) => {
    setIsLoadingReports(true);
    try {
      const params = new URLSearchParams({ page_size: '50' });
      if (query.trim()) params.set('q', query.trim());
      if (institutionFilter) params.set('institution', institutionFilter);
      if (stockFilter?.symbol) params.set('ticker', stockFilter.symbol);
      const response = await fetch(`/api/v1/reports?${params.toString()}`);
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const payload = await response.json() as {
        items: ResearchReportListItem[];
        institutions?: string[];
        institutionRankings?: InstitutionRanking[];
      };
      setReports(payload.items ?? []);
      setInstitutions(payload.institutions ?? []);
      setInstitutionRankings(payload.institutionRankings ?? []);
      const nextId = preferredReportId ?? selectedReportId ?? payload.items?.[0]?.id ?? null;
      setSelectedReportId(payload.items?.some((item) => item.id === nextId) ? nextId : payload.items?.[0]?.id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '研报列表加载失败');
      setReports([]);
      setInstitutionRankings([]);
    } finally {
      setIsLoadingReports(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReports();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, institutionFilter, stockFilter]);

  useEffect(() => {
    if (!selectedReportId) {
      setSelectedReport(null);
      return;
    }
    const controller = new AbortController();
    const loadDetail = async () => {
      setIsLoadingDetail(true);
      try {
        const response = await fetch(`/api/v1/reports/${selectedReportId}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await readErrorMessage(response));
        const detail = await response.json() as ResearchReportDetail;
        setSelectedReport(detail);
        const filteredSeries = stockFilter?.symbol
          ? detail.klineSeries.find((series) => series.symbol === stockFilter.symbol)
          : null;
        setSelectedSymbol(filteredSeries?.symbol ?? detail.klineSeries[0]?.symbol ?? detail.stocks[0]?.symbol ?? null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : '研报详情加载失败');
          setSelectedReport(null);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingDetail(false);
      }
    };
    void loadDetail();
    return () => controller.abort();
  }, [selectedReportId, stockFilter]);

  useEffect(() => {
    const keyword = stockInput.trim();
    if (!isCreateOpen || keyword.length < 1) {
      setStockSearchResults([]);
      setIsSearchingStocks(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearchingStocks(true);
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(keyword)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await readErrorMessage(response));
        const payload = await response.json() as { items?: SearchResultItem[] };
        setStockSearchResults((payload.items ?? []).filter((item) => item.type === 'stock'));
      } catch {
        if (!controller.signal.aborted) setStockSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setIsSearchingStocks(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [isCreateOpen, stockInput]);

  const openCreateDialog = () => {
    const latestReportDate = reports[0]?.date ?? getTodayDateValue();
    setEditingReportId(null);
    setForm({
      ...createEmptyForm(),
      date: latestReportDate,
    });
    setSelectedStocks([]);
    setStockInput('');
    setUploadedFile(null);
    setMessage(null);
    setReportFormError(null);
    setIsCreateOpen(true);
  };  const openEditDialog = () => {
    if (!selectedReport) return;
    setIsCreateOpen(false);
    setEditingReportId(selectedReport.id);
    setReportFormError(null);
    setForm({
      title: selectedReport.title,
      institution: selectedReport.institution,
      rating: selectedReport.rating,
      date: selectedReport.date,
      content: selectedReport.content,
      sourceUrl: selectedReport.sourceUrl ?? '',
    });
    setSelectedStocks(selectedReport.stocks);
    setStockInput('');
    setStockSearchResults([]);
    setUploadedFile(null);
    setMessage(null);
  };

  const closeReportDialog = () => {
    setIsCreateOpen(false);
    setEditingReportId(null);
    setStockInput('');
    setStockSearchResults([]);
    setUploadedFile(null);
    setReportFormError(null);
  };
  const addStock = (item: SearchResultItem) => {
    if (selectedStocks.some((stock) => stock.symbol === item.id)) return;
    setSelectedStocks((stocks) => [...stocks, { symbol: item.id, name: item.title, verdict: 'flat' }]);
    setStockInput('');
    setStockSearchResults([]);
  };

  const removeStock = (symbol: string) => {
    setSelectedStocks((stocks) => stocks.filter((stock) => stock.symbol !== symbol));
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setMessage('仅支持上传 PDF 文件');
      event.target.value = '';
      return;
    }
    const content = await fileToDataUrl(file);
    setUploadedFile({ name: file.name, mime: file.type, content });
  };

  const submitReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReportFormError(null);
    if (!selectedStocks.length) {
      setMessage('请至少选择一只相关股票');
      return;
    }
    if (isEditOpen && !form.title.trim()) {
      setMessage('请填写研报标题');
      return;
    }
    if (!isEditOpen && !form.institution.trim()) {
      setReportFormError('请填写观点方后再保存研报');
      return;
    }
    if (!form.content.trim()) {
      setMessage('请填写研报正文');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(isEditOpen ? `/api/v1/reports/${editingReportId}` : '/api/v1/reports', {
        method: isEditOpen ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEditOpen
          ? {
              title: form.title.trim(),
              stocks: selectedStocks,
              rating: form.rating,
              date: form.date,
              content: form.content.trim(),
            }
          : {
              title: form.title.trim() || undefined,
              stocks: selectedStocks,
              rating: form.rating,
              institution: form.institution.trim(),
              date: form.date,
              content: form.content.trim(),
              sourceUrl: form.sourceUrl.trim() || undefined,
              sourceFileName: uploadedFile?.name,
              sourceFileMime: uploadedFile?.mime,
              sourceFileContent: uploadedFile?.content,
            }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const payload = await response.json() as { id: string };
      const savedReportId = isEditOpen ? editingReportId : payload.id;
      closeReportDialog();
      if (isEditOpen) {
        setSelectedReport(payload as ResearchReportDetail);
      }
      await loadReports(savedReportId ?? undefined);
      setMessage(isEditOpen ? '研报已更新' : '研报已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEditOpen ? '研报更新失败' : '研报保存失败'));
    } finally {
      setIsSaving(false);
    }
  };

  const updateVerdict = async (symbol: string, verdict: ReportVerdict) => {
    if (!selectedReport) return;
    setIsUpdatingVerdict(true);
    try {
      const response = await fetch(`/api/v1/reports/${selectedReport.id}/stocks/${encodeURIComponent(symbol)}/verdict`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const updatedStock = await response.json() as ReportStock;
      const applyStockUpdate = (stock: ReportStock) => (
        stock.symbol === updatedStock.symbol ? { ...stock, verdict: updatedStock.verdict } : stock
      );
      setSelectedReport((report) => report ? {
        ...report,
        stocks: report.stocks.map(applyStockUpdate),
        klineSeries: report.klineSeries.map((series) => (
          series.symbol === updatedStock.symbol ? { ...series, verdict: updatedStock.verdict } : series
        )),
      } : report);
      setReports((items) => items.map((report) => (
        report.id === selectedReport.id ? { ...report, stocks: report.stocks.map(applyStockUpdate) } : report
      )));
      await loadReports(selectedReport.id);
      setEditingVerdictSymbol(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '标记保存失败');
    } finally {
      setIsUpdatingVerdict(false);
    }
  };

  const submitInstitutionCreate = async () => {
    if (!creatingInstitution) return;
    const name = creatingInstitution.name.trim();
    if (!name) {
      setMessage('机构名称不能为空');
      return;
    }

    setIsMutatingInstitution(true);
    try {
      const response = await fetch('/api/v1/reports/institutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      await loadReports();
      setCreatingInstitution(null);
      setMessage('机构已新增');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '新增机构失败');
    } finally {
      setIsMutatingInstitution(false);
    }
  };

  const submitInstitutionRename = async () => {
    if (!editingInstitution) return;
    const newName = editingInstitution.name.trim();
    if (!newName) {
      setMessage('机构名称不能为空');
      return;
    }
    if (newName === editingInstitution.originalName) {
      setEditingInstitution(null);
      return;
    }

    setIsMutatingInstitution(true);
    try {
      const response = await fetch('/api/v1/reports/institutions/name', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution: editingInstitution.originalName, newName }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      await loadReports();
      setSelectedReport((report) => report && report.institution === editingInstitution.originalName
        ? { ...report, institution: newName }
        : report);
      setEditingInstitution(null);
      setMessage('机构名称已更新');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '机构名称更新失败');
    } finally {
      setIsMutatingInstitution(false);
    }
  };

  const confirmDeleteInstitution = async () => {
    if (!deletingInstitution) return;
    setIsMutatingInstitution(true);
    try {
      const response = await fetch('/api/v1/reports/institutions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution: deletingInstitution.institution }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const deletedInstitution = deletingInstitution.institution;
      setDeletingInstitution(null);
      if (selectedReport?.institution === deletedInstitution) {
        setSelectedReportId(null);
        setSelectedReport(null);
      }
      await loadReports();
      setMessage('机构及其研报已删除');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '机构删除失败');
    } finally {
      setIsMutatingInstitution(false);
    }
  };

  const confirmDeleteReport = async () => {
    if (!deletingReport) return;
    setIsDeletingReport(true);
    try {
      const response = await fetch(`/api/v1/reports/${deletingReport.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const deletedReportId = deletingReport.id;
      setDeletingReport(null);
      if (selectedReportId === deletedReportId) {
        setSelectedReportId(null);
        setSelectedReport(null);
      }
      await loadReports();
      setMessage('研报已删除');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '研报删除失败');
    } finally {
      setIsDeletingReport(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-5">
        <div>
          <h1 className="text-4xl md:text-5xl font-extrabold font-headline text-primary">研究报告</h1>
          <p className="text-on-surface-variant mt-3 font-medium">管理机构观点，并跟踪报告发布后的相关标的行情。</p>
        </div>
        <button
          type="button"
          onClick={openCreateDialog}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-primary text-surface rounded-2xl font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-primary/20"
        >
          <Plus size={20} strokeWidth={3} />
          新建研报
        </button>
      </div>

      {message && (
        <div className="rounded-2xl bg-surface-container-low border border-outline-variant/20 px-5 py-3 text-sm font-bold text-primary flex justify-between items-center">
          <span>{message}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setMessage(null)} className="p-1 text-on-surface-variant hover:text-primary">
            <X size={16} />
          </button>
        </div>
      )}

      {stockFilter && (
        <div className="rounded-2xl border border-primary/15 bg-primary-container/30 px-5 py-4 text-primary flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-on-surface-variant">研报筛选中</p>
            <p className="mt-1 text-sm font-bold">
              当前仅显示包含 <span className="font-black">{stockFilterLabel}</span> 的研报
            </p>
          </div>
          <button
            type="button"
            onClick={onClearStockFilter}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-surface-container-lowest px-4 py-2 text-sm font-black text-primary hover:bg-surface-container-low"
          >
            <X size={16} />
            清除筛选
          </button>
        </div>
      )}

      <section className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-[900] font-headline text-primary">观点方胜率排行</h2>
            <p className="mt-1 text-xs font-bold text-on-surface-variant">胜率 = 胜利标的数 / 研报提到标的数</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-black text-on-surface-variant">
              {institutionRankings.length} 个观点方
            </span>
            <button
              type="button"
              onClick={() => setCreatingInstitution({ name: '' })}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-black text-surface"
            >
              <Plus size={14} strokeWidth={3} />
              新增观点方
            </button>
          </div>
        </div>
        {institutionRankings.length === 0 ? (
          <div className="rounded-xl bg-surface-container-low px-4 py-5 text-sm font-bold text-on-surface-variant">
            暂无可统计的观点方胜率
          </div>
        ) : (
          <div className="max-h-64 overflow-auto rounded-xl border border-outline-variant/10 custom-scrollbar">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface-container-highest text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                <tr>
                  <th className="w-14 px-3 py-2 text-left">排名</th>
                  <th className="px-3 py-2 text-left">观点方</th>
                  <th className="w-28 px-3 py-2 text-right">胜率</th>
                  <th className="w-28 px-3 py-2 text-right">胜利/标的</th>
                  <th className="w-24 px-3 py-2 text-right">研报</th>
                  <th className="w-32 px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {institutionRankings.map((ranking, index) => (
                  <tr
                    key={ranking.institution}
                    onClick={() => setInstitutionFilter(ranking.institution)}
                    className="cursor-pointer bg-surface-container-lowest hover:bg-surface-container-low"
                    title={`筛选 ${ranking.institution} 的研报`}
                  >
                    <td className="px-3 py-2">
                      <span className={cn(
                        'inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-black',
                        index === 0 ? 'bg-error-container/20 text-error' : 'bg-surface-container-highest text-primary'
                      )}>
                        {index + 1}
                      </span>
                    </td>
                    <td className="max-w-0 px-3 py-2">
                      <span className="block truncate font-black text-primary">{ranking.institution}</span>
                    </td>
                    <td className={cn('px-3 py-2 text-right font-mono text-base font-[900]', ranking.winRate > 0 ? 'text-error' : 'text-on-surface-variant')}>
                      {ranking.winRate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-black text-on-surface-variant">
                      {ranking.wins}/{ranking.stockMentions}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-black text-on-surface-variant">
                      {ranking.reportCount}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setEditingInstitution({ originalName: ranking.institution, name: ranking.institution })}
                          className="inline-flex items-center justify-center rounded-lg border border-outline-variant/20 bg-surface-container-low px-2 py-1 text-primary hover:bg-surface-container"
                          title={`编辑 ${ranking.institution}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingInstitution(ranking)}
                          className="inline-flex items-center justify-center rounded-lg border border-tertiary-container/20 bg-tertiary-container/10 px-2 py-1 text-tertiary-container hover:bg-tertiary-container/20"
                          title={`删除 ${ranking.institution}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <div className="xl:col-span-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
            <div className="bg-surface-container-highest px-4 py-2.5 rounded-xl border border-outline-variant/10 flex items-center gap-3">
              <Search size={18} className="text-on-surface-variant shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索研报、机构或代码..."
                className="bg-transparent border-none outline-none text-sm w-full"
              />
              {query.trim() && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="清空搜索"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <select
              value={institutionFilter}
              onChange={(event) => setInstitutionFilter(event.target.value)}
              className="bg-surface-container-highest rounded-xl border border-outline-variant/10 px-4 py-2.5 text-sm font-bold text-primary outline-none"
            >
              <option value="">全部观点方</option>
              {institutions.map((institution) => (
                <option key={institution} value={institution}>{institution}</option>
              ))}
            </select>
          </div>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            {isLoadingReports && (
              <div className="p-6 rounded-2xl bg-surface-container-low text-sm font-bold text-on-surface-variant">加载研报中...</div>
            )}
            {!isLoadingReports && reports.length === 0 && (
              <div className="p-8 rounded-2xl bg-surface-container-low text-center">
                <FileText size={40} className="mx-auto text-primary/25 mb-3" />
                <p className="text-sm font-bold text-on-surface-variant">
                  {stockFilter ? '暂无包含该标的的研报' : '暂无研报'}
                </p>
              </div>
            )}
            {reports.map((report) => (
              <button
                type="button"
                key={report.id}
                onClick={() => setSelectedReportId(report.id)}
                className={cn(
                  'w-full text-left p-5 rounded-2xl cursor-pointer transition-all duration-200 border-2',
                  selectedReportId === report.id
                    ? 'bg-surface-container-low border-primary shadow-lg'
                    : 'bg-surface-container-lowest border-transparent hover:bg-surface-container-low/50'
                )}
              >
                <div className="flex justify-between items-start gap-4 mb-4">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black text-on-surface-variant/60 uppercase tracking-widest font-mono mb-1">
                      {report.stocks.map((stock) => stock.symbol).join(' / ')}
                    </div>
                    <h3 className="font-headline font-extrabold text-primary truncate">
                      {report.stocks.map((stock) => stock.name || stock.symbol).join('、')}
                    </h3>
                  </div>
                  <RatingBadge rating={report.rating} />
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {report.stocks.map((stock) => (
                    <VerdictIcon key={stock.symbol} verdict={stock.verdict ?? 'flat'} label={stock.name || stock.symbol} compact />
                  ))}
                </div>
                <h4 className="font-headline font-bold text-lg text-primary leading-tight line-clamp-2">
                  {report.title}
                </h4>
                <div className="flex flex-wrap items-center gap-4 mt-4 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
                  <span className="flex items-center gap-1.5">
                    <Building size={12} className="text-primary" />
                    {report.institution}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-primary" />
                    {report.date}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="xl:col-span-7">
          {selectedReport ? (
            <div className="bg-surface-container-lowest rounded-[2rem] p-6 md:p-8 shadow-sm border border-outline-variant/10 h-full">
              <div className="flex flex-col md:flex-row justify-between items-start gap-6 pb-7 border-b border-surface-container-highest">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <RatingBadge rating={selectedReport.rating} />
                    <span className="text-sm font-black text-primary uppercase font-mono tracking-wider">
                      {selectedReport.stocks.map((stock) => stock.symbol).join(' / ')}
                    </span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-[900] font-headline text-primary leading-tight">
                    {selectedReport.title}
                  </h2>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-3 md:items-end md:text-right">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openEditDialog}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-surface transition-transform hover:scale-[1.01] active:scale-95"
                    >
                      <Pencil size={16} strokeWidth={3} />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingReport(selectedReport)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-tertiary-container px-4 py-2 text-sm font-black text-surface transition-transform hover:scale-[1.01] active:scale-95"
                    >
                      <Trash2 size={16} strokeWidth={3} />
                      删除
                    </button>
                  </div>
                  <div>
                    <p className="text-xs font-black text-on-surface-variant uppercase tracking-[0.2em] mb-1">{selectedReport.institution}</p>
                    <p className="text-sm font-bold text-primary">{selectedReport.date}</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 space-y-5">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <h5 className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">发布日起行情走势</h5>
                  <div className="flex flex-wrap items-center gap-2">
                    {activeSeries && (
                      <button
                        type="button"
                        onClick={() => onOpenStockDetail({ symbol: activeSeries.symbol, name: activeSeries.name })}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-black text-surface hover:scale-[1.01] active:scale-95 transition-transform"
                      >
                        查看详情
                        <ChevronRight size={14} strokeWidth={3} />
                      </button>
                    )}
                    {selectedReport.klineSeries.map((series) => (
                      <div
                        key={series.symbol}
                        className={cn(
                          'relative flex items-center gap-1 rounded-xl border p-1 transition-colors',
                          activeSeries?.symbol === series.symbol
                            ? 'bg-primary text-surface border-primary'
                            : 'bg-surface-container-low text-primary border-outline-variant/20'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedSymbol(series.symbol)}
                          className="px-2 py-1.5 text-xs font-black text-left"
                        >
                          {series.name}
                          <span className={cn(
                            'ml-2 font-mono',
                            activeSeries?.symbol === series.symbol
                              ? 'text-surface'
                              : (series.changePct ?? 0) >= 0 ? 'text-error' : 'text-tertiary-container'
                          )}>
                            {formatPercent(series.changePct)}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`修改 ${series.name} 标记`}
                          onClick={() => setEditingVerdictSymbol((symbol) => symbol === series.symbol ? null : series.symbol)}
                          className="rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <VerdictIcon verdict={series.verdict ?? 'flat'} label={series.name} compact />
                        </button>
                        {editingVerdictSymbol === series.symbol && (
                          <div className="absolute right-0 top-10 z-20 w-36 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-2 shadow-xl">
                            {(Object.keys(verdictMeta) as ReportVerdict[]).map((verdict) => {
                              const meta = verdictMeta[verdict];
                              const Icon = meta.Icon;
                              return (
                                <button
                                  type="button"
                                  key={verdict}
                                  disabled={isUpdatingVerdict}
                                  onClick={() => void updateVerdict(series.symbol, verdict)}
                                  className={cn(
                                    'w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black text-primary hover:bg-surface-container-low disabled:opacity-60',
                                    series.verdict === verdict && 'bg-surface-container-low'
                                  )}
                                >
                                  <Icon size={15} strokeWidth={3} />
                                  {meta.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-surface-container-low p-4">
                  {isLoadingDetail ? (
                    <div className="h-72 flex items-center justify-center text-sm font-bold text-on-surface-variant">加载行情中...</div>
                  ) : (
                    <KlineChart series={activeSeries} />
                  )}
                </div>
              </div>

              <div className="mt-8 space-y-5">
                <h5 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] border-b border-primary/10 pb-2 inline-block">核心观点摘要</h5>
                <p className="text-on-surface-variant font-medium leading-relaxed text-base md:text-lg whitespace-pre-wrap">
                  {selectedReport.content}
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  {selectedReport.sourceUrl && (
                    <a
                      href={selectedReport.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-sm font-black text-primary hover:gap-3 transition-all"
                    >
                      原链接
                      <ExternalLink size={16} />
                    </a>
                  )}
                  {selectedReport.sourceFileName && (
                    <a
                      href={`/api/v1/reports/${selectedReport.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-sm font-black text-primary hover:gap-3 transition-all"
                    >
                      {selectedReport.sourceFileName}
                      <ChevronRight size={16} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[520px] flex items-center justify-center bg-surface-container-low rounded-[2rem] border border-dashed border-primary/20">
              <div className="text-center space-y-4">
                <FileText size={48} className="mx-auto text-primary/20" />
                <p className="text-on-surface-variant font-bold">选择一份研报查看详情</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {creatingInstitution && (
        <div className="fixed inset-0 z-50 bg-primary/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="institution-create-dialog-title"
            className="w-full max-w-md rounded-[2rem] bg-surface-container-lowest p-6 shadow-2xl border border-outline-variant/20 space-y-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="institution-create-dialog-title" className="text-2xl font-[900] font-headline text-primary">新增观点方</h2>
                <p className="mt-1 text-sm font-medium text-on-surface-variant">新增后可在新建研报时直接选择。</p>
              </div>
              <button
                type="button"
                onClick={() => setCreatingInstitution(null)}
                className="p-2 rounded-xl hover:bg-surface-container-low text-primary"
                aria-label="关闭新增机构弹窗"
              >
                <X size={18} />
              </button>
            </div>
            <label className="space-y-2 block">
              <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">机构名称</span>
              <input
                type="text"
                value={creatingInstitution.name}
                onChange={(event) => setCreatingInstitution((state) => state ? { ...state, name: event.target.value } : state)}
                className="w-full rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 text-sm font-bold outline-none focus:border-primary"
                placeholder="请输入机构名称"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreatingInstitution(null)}
                className="px-4 py-2 rounded-xl bg-surface-container-low text-primary text-sm font-black hover:bg-surface-container"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isMutatingInstitution}
                onClick={() => void submitInstitutionCreate()}
                className="px-4 py-2 rounded-xl bg-primary text-surface text-sm font-black disabled:opacity-60"
              >
                {isMutatingInstitution ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingInstitution && (
        <div className="fixed inset-0 z-50 bg-primary/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="institution-edit-dialog-title"
            className="w-full max-w-md rounded-[2rem] bg-surface-container-lowest p-6 shadow-2xl border border-outline-variant/20 space-y-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="institution-edit-dialog-title" className="text-2xl font-[900] font-headline text-primary">编辑机构名称</h2>
                <p className="mt-1 text-sm font-medium text-on-surface-variant">仅修改机构名称，历史统计将自动同步。</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingInstitution(null)}
                className="p-2 rounded-xl hover:bg-surface-container-low text-primary"
                aria-label="关闭编辑机构弹窗"
              >
                <X size={18} />
              </button>
            </div>
            <label className="space-y-2 block">
              <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">机构名称</span>
              <input
                type="text"
                value={editingInstitution.name}
                onChange={(event) => setEditingInstitution((state) => state ? { ...state, name: event.target.value } : state)}
                className="w-full rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 text-sm font-bold outline-none focus:border-primary"
                placeholder="请输入机构名称"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingInstitution(null)}
                className="px-4 py-2 rounded-xl bg-surface-container-low text-primary text-sm font-black hover:bg-surface-container"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isMutatingInstitution}
                onClick={() => void submitInstitutionRename()}
                className="px-4 py-2 rounded-xl bg-primary text-surface text-sm font-black disabled:opacity-60"
              >
                {isMutatingInstitution ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingInstitution && (
        <div className="fixed inset-0 z-50 bg-primary/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="institution-delete-dialog-title"
            className="w-full max-w-md rounded-[2rem] bg-surface-container-lowest p-6 shadow-2xl border border-outline-variant/20 space-y-5"
          >
            <div>
              <h2 id="institution-delete-dialog-title" className="text-2xl font-[900] font-headline text-primary">确认删除机构</h2>
              <p className="mt-2 text-sm font-medium text-on-surface-variant">
                删除后会移除该机构下所有研报与关联行情记录，且无法恢复。
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 space-y-1.5">
              <p className="text-sm font-black text-primary">{deletingInstitution.institution}</p>
              <p className="text-xs font-bold text-on-surface-variant">胜率：{deletingInstitution.winRate.toFixed(1)}%</p>
              <p className="text-xs font-bold text-on-surface-variant">研报数量：{deletingInstitution.reportCount}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingInstitution(null)}
                className="px-4 py-2 rounded-xl bg-surface-container-low text-primary text-sm font-black hover:bg-surface-container"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isMutatingInstitution}
                onClick={() => void confirmDeleteInstitution()}
                className="px-4 py-2 rounded-xl bg-tertiary-container text-surface text-sm font-black disabled:opacity-60"
              >
                {isMutatingInstitution ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingReport && (
        <div className="fixed inset-0 z-50 bg-primary/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-delete-dialog-title"
            className="w-full max-w-md rounded-[2rem] bg-surface-container-lowest p-6 shadow-2xl border border-outline-variant/20 space-y-5"
          >
            <div>
              <h2 id="report-delete-dialog-title" className="text-2xl font-[900] font-headline text-primary">确认删除研报</h2>
              <p className="mt-2 text-sm font-medium text-on-surface-variant">
                删除后该研报及关联标的标记、历史行情快照将被移除，且无法恢复。
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 space-y-1.5">
              <p className="text-sm font-black text-primary line-clamp-2">{deletingReport.title}</p>
              <p className="text-xs font-bold text-on-surface-variant">观点方：{deletingReport.institution}</p>
              <p className="text-xs font-bold text-on-surface-variant">日期：{deletingReport.date}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingReport(null)}
                className="px-4 py-2 rounded-xl bg-surface-container-low text-primary text-sm font-black hover:bg-surface-container"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeletingReport}
                onClick={() => void confirmDeleteReport()}
                className="px-4 py-2 rounded-xl bg-tertiary-container text-surface text-sm font-black disabled:opacity-60"
              >
                {isDeletingReport ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isReportDialogOpen && (
        <div className="fixed inset-0 z-50 bg-primary/30 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={submitReport}
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-dialog-title"
            className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[2rem] bg-surface-container-lowest p-6 md:p-8 shadow-2xl border border-outline-variant/20 space-y-6"
          >
            <div className="flex justify-between items-start gap-4">
              <div>
                <h2 id="report-dialog-title" className="text-3xl font-[900] font-headline text-primary">
                  {isEditOpen ? '编辑研报' : '新建研报'}
                </h2>
                <p className="text-sm font-medium text-on-surface-variant mt-2">
                  {isEditOpen ? '修改标题、日期、标签和正文。' : '填写机构观点和来源材料。'}
                </p>
              </div>
              <button type="button" aria-label="关闭弹窗" onClick={closeReportDialog} className="p-2 rounded-xl hover:bg-surface-container-low text-primary">
                <X size={20} />
              </button>
            </div>

            {!isEditOpen && reportFormError && (
              <div className="rounded-xl border border-error-container/50 bg-error-container/20 px-4 py-3 text-sm font-black text-error">
                {reportFormError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!isEditOpen && (
                <label className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">观点方</span>
                  <select
                    value={form.institution}
                    onChange={(event) => {
                      const value = event.target.value;
                      setForm((state) => ({ ...state, institution: value }));
                      if (value.trim()) setReportFormError(null);
                    }}
                    className="w-full rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 text-sm font-bold text-primary outline-none focus:border-primary"
                  >
                    <option value="">请选择观点方</option>
                    {institutions.map((institution) => (
                      <option key={institution} value={institution}>{institution}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">日期</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((state) => ({ ...state, date: event.target.value }))}
                  className="w-full rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 text-sm font-bold outline-none focus:border-primary"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">标签</span>
                <select
                  value={form.rating}
                  onChange={(event) => setForm((state) => ({ ...state, rating: event.target.value as Rating }))}
                  className="w-full rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 text-sm font-bold outline-none focus:border-primary"
                >
                  <option value="buy">买入</option>
                  <option value="sell">卖出</option>
                  <option value="hold">维持</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">标题</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))}
                  placeholder={isEditOpen ? '研报标题' : '可留空自动生成'}
                  className="w-full rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 text-sm font-bold outline-none focus:border-primary"
                />
              </label>
            </div>

            <div className="space-y-3">
              <label className="space-y-2 block">
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">相关股票</span>
                <div className="relative">
                  <div className="rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 flex items-center gap-3">
                    <Search size={18} className="text-on-surface-variant shrink-0" />
                    <input
                      type="text"
                      value={stockInput}
                      onChange={(event) => setStockInput(event.target.value)}
                      placeholder="输入代码或名称"
                      className="bg-transparent border-none outline-none text-sm font-bold w-full"
                    />
                  </div>
                  {(isSearchingStocks || stockSearchResults.length > 0) && (
                    <div className="absolute z-10 mt-2 w-full rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl overflow-hidden">
                      {isSearchingStocks && <div className="px-4 py-3 text-xs font-bold text-on-surface-variant">搜索中...</div>}
                      {!isSearchingStocks && stockSearchResults.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => addStock(item)}
                          className="w-full px-4 py-3 text-left hover:bg-surface-container-low transition-colors"
                        >
                          <span className="block text-sm font-black text-primary">{item.title}</span>
                          <span className="block text-xs font-mono text-on-surface-variant">{item.id} · {item.subtitle}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>
              <div className="flex flex-wrap gap-2">
                {selectedStocks.map((stock) => (
                  <span key={stock.symbol} className="inline-flex items-center gap-2 rounded-xl bg-primary text-surface px-3 py-2 text-xs font-black">
                    {stock.name || stock.symbol}
                    <button type="button" aria-label={`移除 ${stock.symbol}`} onClick={() => removeStock(stock.symbol)} className="text-surface/80 hover:text-surface">
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <label className="space-y-2 block">
              <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">正文</span>
              <textarea
                value={form.content}
                onChange={(event) => setForm((state) => ({ ...state, content: event.target.value }))}
                rows={7}
                placeholder="粘贴研报文本或摘要"
                className="w-full rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 text-sm font-medium outline-none focus:border-primary resize-none"
              />
            </label>

            {!isEditOpen && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">原链接</span>
                  <input
                    type="url"
                    value={form.sourceUrl}
                    onChange={(event) => setForm((state) => ({ ...state, sourceUrl: event.target.value }))}
                    placeholder="https://..."
                    className="w-full rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 text-sm font-bold outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">PDF 文件</span>
                  <div className="rounded-xl bg-surface-container-low border border-outline-variant/20 px-4 py-3 flex items-center gap-3">
                    <Upload size={18} className="text-primary shrink-0" />
                    <input type="file" accept="application/pdf" onChange={handleFileChange} className="w-full text-xs font-bold text-on-surface-variant" />
                  </div>
                  {uploadedFile && <p className="text-xs font-bold text-primary truncate">{uploadedFile.name}</p>}
                </label>
              </div>
            )}

            <div className="flex flex-col-reverse md:flex-row justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeReportDialog}
                className="px-5 py-3 rounded-xl bg-surface-container-low text-primary text-sm font-black hover:bg-surface-container"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-6 py-3 rounded-xl bg-primary text-surface text-sm font-black hover:scale-[1.01] active:scale-95 transition-transform disabled:opacity-60"
              >
                {isSaving ? '保存中...' : (isEditOpen ? '更新研报' : '保存研报')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
