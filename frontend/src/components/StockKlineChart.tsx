import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { cn } from '@/src/lib/utils';

export interface StockKlinePoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

type StockKlineChartMode = 'line' | 'kline';

interface StockKlineChartProps {
  points: StockKlinePoint[];
  mode?: StockKlineChartMode;
  className?: string;
  emptyMessage?: string;
  heightClassName?: string;
}

interface HoverState {
  point: StockKlinePoint;
  x: number;
  y: number;
}

interface PreparedPoint {
  source: StockKlinePoint;
  time: UTCTimestamp;
  timeKey: string;
}

const formatPrice = (value: number) => value.toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatVolume = (value: number) => value.toLocaleString('zh-CN');

const formatIsoDate = (ms: number) => {
  const value = new Date(ms);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const asTimestamp = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

const isoWeekStartUtc = (year: number, week: number) => {
  const janFourth = new Date(Date.UTC(year, 0, 4));
  const janFourthDay = janFourth.getUTCDay() || 7;
  return Date.UTC(year, 0, 4 - (janFourthDay - 1) + (week - 1) * 7);
};

const formatChartDate = (date: string) => {
  const weekMatch = /^(\d{4})-W(\d{1,2})$/.exec(date);
  if (weekMatch) {
    const weekEndUtc = isoWeekStartUtc(Number(weekMatch[1]), Number(weekMatch[2])) + 4 * 24 * 60 * 60 * 1000;
    return formatChartDate(formatIsoDate(weekEndUtc));
  }
  const parts = date.split('-');
  if (parts.length >= 3) return `${Number(parts[1])}/${Number(parts[2])}`;
  if (parts.length === 2) return `${Number(parts[0])}/${Number(parts[1])}`;
  return date;
};

const chartTimeForDate = (date: string, index: number) => {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (dayMatch) {
    return asTimestamp(Date.UTC(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3])));
  }

  const weekMatch = /^(\d{4})-W(\d{1,2})$/.exec(date);
  if (weekMatch) {
    return asTimestamp(isoWeekStartUtc(Number(weekMatch[1]), Number(weekMatch[2])));
  }

  const monthDayMatch = /^(\d{1,2})-(\d{1,2})$/.exec(date);
  if (monthDayMatch) {
    return asTimestamp(Date.UTC(2000, Number(monthDayMatch[1]) - 1, Number(monthDayMatch[2])));
  }

  const parsed = Date.parse(date);
  return asTimestamp(Number.isFinite(parsed) ? parsed : Date.UTC(2000, 0, index + 1));
};

const isLineData = (value: unknown): value is LineData<Time> => (
  typeof value === 'object' && value !== null && 'value' in value && 'time' in value
);

const isCandlestickData = (value: unknown): value is CandlestickData<Time> => (
  typeof value === 'object' && value !== null && 'open' in value && 'close' in value && 'time' in value
);

export const StockKlineChart: React.FC<StockKlineChartProps> = ({
  points,
  mode = 'kline',
  className,
  emptyMessage = '暂无该区间行情数据',
  heightClassName = 'h-72',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const data = useMemo(() => points.filter((point) => (
    Number.isFinite(point.open)
    && Number.isFinite(point.close)
    && Number.isFinite(point.high)
    && Number.isFinite(point.low)
  )), [points]);
  const chartPoints = useMemo<PreparedPoint[]>(() => data.map((point, index) => {
    const time = chartTimeForDate(point.date, index);
    return {
      source: point,
      time,
      timeKey: String(time),
    };
  }), [data]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartPoints.length === 0) return undefined;

    setHovered(null);

    const primary = getCssColor('--color-primary', '#00343e');
    const surface = getCssColor('--color-surface-container-low', '#f2f4f5');
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const chartBackground = isDark ? '#000000' : surface;
    const text = getCssColor('--color-on-surface-variant', '#40484c');
    const outline = getCssColor('--color-outline-variant', '#c0c7cd');
    const upColor = getCssColor('--color-error', '#ba1a1a');
    const downColor = getCssColor('--color-tertiary-container', '#005111');
    const labelByTime = new Map<string, string>(chartPoints.map((point) => [point.timeKey, point.source.date]));

    const chart = createChart(container, {
      autoSize: true,
      height: container.clientHeight || 288,
      layout: {
        background: { type: ColorType.Solid, color: chartBackground },
        textColor: text,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'transparent' },
        horzLines: { color: `${outline}66`, style: 3 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: `${primary}70`, labelVisible: false },
        horzLine: { color: `${primary}40`, labelVisible: true },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: mode === 'kline' ? { top: 0.08, bottom: 0.26 } : { top: 0.12, bottom: 0.16 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: unknown) => {
          const key = String(time);
          return formatChartDate(labelByTime.get(key) ?? key);
        },
      },
      localization: {
        priceFormatter: (price) => formatPrice(price),
      },
      handleScroll: true,
      handleScale: true,
    });

    let priceSeries: ISeriesApi<'Candlestick' | 'Line'>;
    const byTime = new Map<string, StockKlinePoint>(chartPoints.map((point) => [point.timeKey, point.source]));

    if (mode === 'kline') {
      priceSeries = chart.addSeries(CandlestickSeries, {
        upColor,
        downColor,
        borderUpColor: upColor,
        borderDownColor: downColor,
        wickUpColor: upColor,
        wickDownColor: downColor,
        priceLineVisible: false,
      });
      priceSeries.setData(chartPoints.map((point): CandlestickData => ({
        time: point.time,
        open: point.source.open,
        high: point.source.high,
        low: point.source.low,
        close: point.source.close,
      })));

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volumeSeries.setData(chartPoints.map((point): HistogramData => ({
        time: point.time,
        value: point.source.volume || 0,
        color: point.source.close >= point.source.open ? `${upColor}33` : `${downColor}30`,
      })));
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });
    } else {
      priceSeries = chart.addSeries(LineSeries, {
        color: primary,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
      });
      priceSeries.setData(chartPoints.map((point): LineData => ({
        time: point.time,
        value: point.source.close,
      })));
    }

    chart.timeScale().fitContent();

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const seriesData = param.seriesData.get(priceSeries);
      if (!param.point || (!isCandlestickData(seriesData) && !isLineData(seriesData))) {
        setHovered(null);
        return;
      }

      const source = byTime.get(String(seriesData.time));
      if (!source) {
        setHovered(null);
        return;
      }

      const tooltipWidth = 176;
      const tooltipHeight = mode === 'kline' ? 142 : 126;
      const padding = 12;
      const nextX = Math.max(padding, Math.min(container.clientWidth - tooltipWidth - padding, param.point.x + 16));
      const nextY = Math.max(padding, Math.min(container.clientHeight - tooltipHeight - padding, param.point.y + 16));

      setHovered({ point: source, x: nextX, y: nextY });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
    };
  }, [chartPoints, mode]);

  if (data.length === 0) {
    return (
      <div className={cn(heightClassName, 'w-full rounded-xl bg-surface-container-low flex items-center justify-center text-sm font-bold text-on-surface-variant', className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn(heightClassName, 'relative w-full rounded-xl bg-surface-container-low overflow-hidden', className)}>
      <div ref={containerRef} className="h-full w-full" />
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 w-44 rounded-xl border border-outline-variant/40 bg-white/95 p-3 text-[11px] font-bold text-primary shadow-xl backdrop-blur"
          style={{ left: hovered.x, top: hovered.y }}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-black">{hovered.point.date}</span>
            <span className={cn('font-mono', hovered.point.close >= hovered.point.open ? 'text-error' : 'text-tertiary-container')}>
              {formatPrice(hovered.point.close)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-on-surface-variant">
            <span>开 {formatPrice(hovered.point.open)}</span>
            <span>高 {formatPrice(hovered.point.high)}</span>
            <span>低 {formatPrice(hovered.point.low)}</span>
            <span>收 {formatPrice(hovered.point.close)}</span>
            <span className="col-span-2">量 {formatVolume(hovered.point.volume || 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
