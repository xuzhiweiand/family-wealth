/**
 * 趋势（底部 Tab，无返回）
 *
 * 对照 v0.6.0 高保真单页「v0.6.0-trend.html」复刻：
 *   页头（右侧低调区间切换）→ 墨绿 hero（累计增长 / 期初 / 期末 / 连涨）
 *   → 柱 + 环比金色虚线组合图 → 月度明细（最近 6 个月，可滑动、点击展开资产明细）。
 *
 * 数据口径不变（全部本机计算，服务端只见密文，ADR-0006）：
 *   buildTrendSeries 先取每日序列 → 按 日 / ISO 周 / 自然月 / 自然年 归并；
 *   月视图窗口随屏宽 6 / 12 个月，环比增长由 buildMonthGrowthLabels 计算，
 *   金额一律以「分」为单位计算，展示时再换算。
 */

import { COLORS, GRADIENTS } from '../../theme';
import { MONEY_TEXT, SERIF_CN_TEXT } from '../../typography';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Svg, {
  Circle, Defs, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText,
} from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';
import { buildTrendSeries } from '@family-wealth/analytics';
import { formatCNY, formatPct, pctChange } from '@family-wealth/shared-utils';
import { filterVisibleAssets } from '@family-wealth/family';
import type { TrendPoint } from '@family-wealth/shared-types';
import { useAuthStore } from '../../stores/auth-store';
import { useAssetStore } from '../../stores/asset-store';
import { useFamilyStore } from '../../stores/family-store';
import { OfflineBanner } from '../../components/OfflineBanner';
import {
  buildMonthGrowthLabels,
  buildMonthlyAssetDetails,
  type MonthAssetDetail,
  type MonthGrowthLabel,
} from '../../lib/asset-meta';
import type { AssetType } from '@family-wealth/shared-types';

/**
 * 月视图窗口：直板机只放得下 6 个月，折叠机展开（屏宽 ≥ 600pt）展示 12 个月。
 * 图表、hero、明细统一按这个窗口，避免各区域口径不一致。
 */
const MONTH_WINDOW_BREAKPOINT = 600;
const MONTH_WINDOW_NARROW = 6;
const MONTH_WINDOW_WIDE = 12;
/** 月度明细默认展示最近 6 个月；整页滑到底部继续加载更早 6 个月 */
const DETAIL_ROWS = 6;

const PAGE_PAD = 20;
const HERO_HEIGHT = 204;
const HERO_RADIUS = 26;

/** 组合图几何：与设计稿 330×190 的比例一致 */
const CHART_HEIGHT = 190;
const PLOT_TOP = 34;
const PLOT_BOTTOM = 152;
const GUTTER_LEFT = 32;
const GUTTER_RIGHT = 4;
/** 环比折线的纵向区间（落在柱子上半部） */
const PCT_TOP = PLOT_TOP + 10;
const PCT_BOTTOM = PLOT_BOTTOM - 42;
/** 横轴刻度每个标签至少占的宽度，点数多时按此抽稀，避免重叠 */
const AXIS_LABEL_SLOT = 34;

type RangeKey = 'D' | 'W' | 'M' | 'Y';

const RANGE_PRESETS: Record<RangeKey, { label: string; days: number; bucket: 'day' | 'week' | 'month' | 'year' }> = {
  D: { label: '日', days: 30, bucket: 'day' },
  W: { label: '周', days: 90, bucket: 'week' },
  M: { label: '月', days: 365, bucket: 'month' },
  Y: { label: '年', days: 365 * 5, bucket: 'year' },
};

const RANGE_HINT: Record<RangeKey, string> = {
  D: '近 30 天',
  W: '近 13 周',
  M: '近 6 个月',
  Y: '近 5 年',
};

function fromDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** ISO 周桶 key：YYYY-Www */
function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function bucketKey(dateStr: string, bucket: 'day' | 'week' | 'month' | 'year'): string {
  if (bucket === 'day') return dateStr;
  if (bucket === 'week') return isoWeekKey(dateStr);
  if (bucket === 'month') return dateStr.slice(0, 7);
  return dateStr.slice(0, 4);
}

/**
 * 每日序列 → 分桶序列（每桶取最后一点，Map 插入顺序保持时间先后）。
 * 非日桶把 date 规范为桶 key（月 'YYYY-MM' / 周 'YYYY-Www' / 年 'YYYY'）。
 */
function bucketize(series: readonly TrendPoint[], bucket: 'day' | 'week' | 'month' | 'year'): TrendPoint[] {
  if (bucket === 'day') return [...series];
  const map = new Map<string, TrendPoint>();
  for (const p of series) map.set(bucketKey(p.date, bucket), p);
  return [...map.entries()].map(([key, p]) => ({ ...p, date: key }));
}

/** 金额（分）→ '3,356,200'（元，无 ¥ 前缀，hero 大号金额用） */
function amountText(cents: number): string {
  return formatCNY(cents, { fraction: false }).replace('¥', '');
}

/** 金额（分）→ 万元数值（digits 位小数，卡片口径统一以万元展示） */
function wanText(cents: number, digits: number): string {
  return (cents / 1_000_000).toFixed(digits);
}

/** 桶 key → hero 三列里的短日期（月 '06 月' / 日 '05-06' / 周 'W45 周' / 年 '2026 年'） */
function shortDateLabel(key: string | undefined): string {
  if (key === undefined) return '—';
  if (/^\d{4}-\d{2}$/.test(key)) return `${key.slice(5)} 月`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key.slice(5, 10);
  if (/^\d{4}-W\d{2}$/.test(key)) return `${key.slice(5)} 周`;
  return `${key} 年`;
}

/** 桶 key → 图表横轴短标签 */
function axisShort(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) return `${key.slice(5)}月`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key.slice(5);
  if (/^\d{4}-W\d{2}$/.test(key)) return key.slice(5);
  return key;
}

/** 点数过多时抽稀刻度（始终保留首末） */
function pickLabelIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>([0, n - 1]);
  for (let i = 1; i < max - 1; i++) {
    out.add(Math.round((i / (max - 1)) * (n - 1)));
  }
  return [...out].sort((a, b) => a - b);
}

/** 资产类型 → 明细展开区的小图标芯片（26px 圆角 8） */
function detailChipTone(type: AssetType): { bg: string; color: string } {
  if (type === 'debt') return { bg: COLORS.dangerWash, color: COLORS.danger };
  if (['fund', 'stock', 'wealth_management', 'precious_metal', 'crypto'].includes(type)) {
    return { bg: COLORS.warningWash, color: COLORS.goldDeep };
  }
  return { bg: COLORS.inkWash, color: COLORS.ink };
}

function detailChipIcon(type: AssetType): React.ReactNode {
  switch (type) {
    case 'cash':
    case 'bank_deposit':
      return (
        <>
          <Rect width={20} height={12} x={2} y={6} rx={2} />
          <Path d="M6 12h.01M18 12h.01" />
        </>
      );
    case 'fund':
    case 'stock':
    case 'wealth_management':
    case 'crypto':
      return (
        <>
          <Path d="M3 3v16a2 2 0 0 0 2 2h16" />
          <Path d="m19 9-5 5-4-4-3 3" />
        </>
      );
    case 'precious_metal':
      return (
        <>
          <Circle cx={12} cy={12} r={8} />
          <Path d="M12 8v8M9.5 9.7h4a1.6 1.6 0 0 1 0 3.2h-3a1.6 1.6 0 0 0 0 3.2h4" />
        </>
      );
    case 'real_estate':
      return (
        <>
          <Path d="m3 11 9-8 9 8" />
          <Path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
        </>
      );
    case 'vehicle':
      return (
        <>
          <Path d="M5 17h14l-1.5-6.5a2 2 0 0 0-2-1.5h-7a2 2 0 0 0-2 1.5L5 17Z" />
          <Path d="M7 17v2M17 17v2" />
        </>
      );
    case 'receivable':
      return <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
    default:
      return (
        <>
          <Rect width={20} height={14} x={2} y={5} rx={2} />
          <Path d="M2 10h20" />
        </>
      );
  }
}

/** 金色发丝分隔线（透明 → 金 → 透明） */
function GoldHairline({ width }: { width: number }) {
  return (
    <View style={{ marginVertical: 16 }}>
      <Svg width={width} height={1}>
        <Defs>
          <LinearGradient id="trendHeroHairline" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={COLORS.gold} stopOpacity={0} />
            <Stop offset="0.5" stopColor={COLORS.gold} stopOpacity={0.5} />
            <Stop offset="1" stopColor={COLORS.gold} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={1} fill="url(#trendHeroHairline)" />
      </Svg>
    </View>
  );
}

interface TrendBarChartProps {
  data: readonly TrendPoint[];
  growth: readonly MonthGrowthLabel[];
  width: number;
}

/**
 * 柱状（净资产）+ 金色虚线折线（环比）组合图。
 * 柱高按真实净资产映射，上下留白 12%，柱顶标涨幅、柱底标数值与月份。
 */
function TrendBarChart({ data, growth, width }: TrendBarChartProps) {
  const values = data.map((p) => p.netWorth);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const dataSpan = dataMax - dataMin;
  const padding = dataSpan > 0
    ? dataSpan * 0.12
    : Math.max(Math.abs(dataMax) * 0.02, 1_000_000);
  const low = dataMin - padding;
  const high = dataMax + padding;
  const domain = high - low || 1;
  const yOf = (v: number) => PLOT_BOTTOM - ((v - low) / domain) * (PLOT_BOTTOM - PLOT_TOP);

  const plotWidth = Math.max(1, width - GUTTER_LEFT - GUTTER_RIGHT);
  const step = plotWidth / data.length;
  const barWidth = Math.min(26, step * 0.62);
  const centerX = (i: number) => GUTTER_LEFT + step * (i + 0.5);
  const lastIndex = data.length - 1;
  const tickValues = [high, high - domain / 3, high - domain * 2 / 3, low];
  const maxLabels = Math.max(6, Math.floor(plotWidth / AXIS_LABEL_SLOT));
  const labelIndices = pickLabelIndices(data.length, maxLabels);

  const pctPoints = growth
    .map((g, i) => (g.pct === null || i >= data.length ? null : { i, pct: g.pct }))
    .filter((p): p is { i: number; pct: number } => p !== null);
  const pctMin = pctPoints.length > 0 ? Math.min(...pctPoints.map((p) => p.pct)) : 0;
  const pctMax = pctPoints.length > 0 ? Math.max(...pctPoints.map((p) => p.pct)) : 0;
  const pctDomain = pctMax - pctMin;
  const pctMid = (PCT_TOP + PCT_BOTTOM) / 2;
  const pctY = (v: number) => (pctDomain === 0
    ? pctMid
    : PCT_BOTTOM - ((v - pctMin) / pctDomain) * (PCT_BOTTOM - PCT_TOP));
  const pctPath = pctPoints.length >= 2
    ? pctPoints
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${centerX(p.i).toFixed(1)},${pctY(p.pct).toFixed(1)}`)
      .join(' ')
    : '';

  const lastTop = yOf(values[lastIndex] ?? low);

  return (
    <Svg width={width} height={CHART_HEIGHT}>
      {/* 网格线 + 左侧金额刻度（万元） */}
      {tickValues.map((t, i) => (
        <Line
          key={`grid-${i}`}
          x1={GUTTER_LEFT}
          x2={width - GUTTER_RIGHT}
          y1={yOf(t)}
          y2={yOf(t)}
          stroke={COLORS.divider}
          strokeWidth={1}
        />
      ))}
      {tickValues.map((t, i) => (
        <SvgText
          key={`tick-${i}`}
          x={GUTTER_LEFT - 6}
          y={yOf(t) + 3}
          fontSize={8}
          fill={COLORS.faint}
          textAnchor="end"
        >
          {Math.round(t / 1_000_000)}
        </SvgText>
      ))}

      {/* 当前月金色柱的光晕 */}
      <Rect
        x={centerX(lastIndex) - (barWidth + 6) / 2}
        y={lastTop - 3}
        width={barWidth + 6}
        height={PLOT_BOTTOM - lastTop + 3}
        rx={8}
        fill={COLORS.gold}
        opacity={0.14}
      />

      {/* 净资产柱：当前月金色，其余墨绿 85% */}
      {values.map((v, i) => {
        const top = yOf(v);
        const isLast = i === lastIndex;
        return (
          <Rect
            key={`bar-${i}`}
            x={centerX(i) - barWidth / 2}
            y={top}
            width={barWidth}
            height={Math.max(2, PLOT_BOTTOM - top)}
            rx={4}
            fill={isLast ? COLORS.gold : COLORS.ink}
            opacity={isLast ? 0.95 : 0.85}
            stroke={isLast ? COLORS.goldLight : COLORS.transparent}
            strokeOpacity={isLast ? 0.55 : 0}
            strokeWidth={1}
          />
        );
      })}

      {/* 环比折线（金色虚线 + 圆点） */}
      {pctPath === '' ? null : (
        <Path
          d={pctPath}
          fill="none"
          stroke={COLORS.gold}
          strokeWidth={1.8}
          strokeDasharray="1 3"
          strokeLinecap="round"
        />
      )}
      {pctPoints.map((p) => (
        <Circle
          key={`dot-${p.i}`}
          cx={centerX(p.i)}
          cy={pctY(p.pct)}
          r={p.i === lastIndex ? 3 : 2.5}
          fill={COLORS.gold}
          stroke={COLORS.surface}
          strokeWidth={1}
        />
      ))}

      {/* 柱顶涨幅 */}
      {growth.map((g, i) => {
        if (i >= data.length) return null;
        const top = yOf(values[i] ?? low);
        const pct = g.pct;
        return (
          <SvgText
            key={`pct-${i}`}
            x={centerX(i)}
            y={Math.max(PLOT_TOP - 6, top - 6)}
            fontSize={8.5}
            fill={pct === null ? COLORS.faint : COLORS.goldDeep}
            fontWeight={i === lastIndex ? '700' : '400'}
            textAnchor="middle"
          >
            {pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
          </SvgText>
        );
      })}

      {/* 柱底数值（万元，1 位小数）与月份 */}
      {labelIndices.map((i) => (
        <SvgText
          key={`value-${i}`}
          x={centerX(i)}
          y={PLOT_BOTTOM + 14}
          fontSize={8.5}
          fill={i === lastIndex ? COLORS.ink : COLORS.sub}
          fontWeight={i === lastIndex ? '700' : '400'}
          textAnchor="middle"
        >
          {wanText(values[i] ?? 0, 1)}
        </SvgText>
      ))}
      {labelIndices.map((i) => (
        <SvgText
          key={`month-${i}`}
          x={centerX(i)}
          y={PLOT_BOTTOM + 30}
          fontSize={9}
          fill={i === lastIndex ? COLORS.ink : COLORS.faint}
          fontWeight={i === lastIndex ? '700' : '400'}
          textAnchor="middle"
        >
          {axisShort(data[i]!.date)}
        </SvgText>
      ))}
    </Svg>
  );
}

export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<RangeKey>('M');
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  // 月度明细窗口：初始 6 个月；整页滑到底部继续追加 6 个月
  const [detailLimit, setDetailLimit] = useState(DETAIL_ROWS);

  const user = useAuthStore((s) => s.user);
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const loading = useAssetStore((s) => s.loading);
  const load = useAssetStore((s) => s.load);
  const sharedFamily = useFamilyStore((s) => s.family);
  const familyId = sharedFamily?.id ?? 'demo-family';

  useEffect(() => {
    void load(familyId);
  }, [familyId, load]);

  const visibleAssets = useMemo(
    () =>
      filterVisibleAssets(
        assets.filter((a) => a.deletedAt === null),
        user?.id ?? '',
        useFamilyStore.getState().members.find((m) => m.userId === user?.id)?.role ?? 'viewer',
      ),
    [assets, user?.id],
  );

  const { width: screenWidth } = useWindowDimensions();
  // 月视图窗口按屏宽自适应：直板机 6 个月，折叠机展开 12 个月
  const monthWindow = screenWidth >= MONTH_WINDOW_BREAKPOINT ? MONTH_WINDOW_WIDE : MONTH_WINDOW_NARROW;

  const preset = RANGE_PRESETS[range];
  const cardWidth = Math.max(1, screenWidth - PAGE_PAD * 2);

  // 取整窗口每日序列再分桶
  const series = useMemo(() => {
    const daily = buildTrendSeries(snapshots, visibleAssets, {
      from: fromDaysAgo(preset.days),
      familyId,
    });
    return bucketize(daily, preset.bucket);
  }, [snapshots, visibleAssets, preset.days, preset.bucket, familyId]);

  // 月视图：窗口按屏宽取 6 / 12 个月；增长标签相对完整序列的前一个月计算
  const displaySeries = useMemo(
    () => (preset.bucket === 'month' ? series.slice(-monthWindow) : series),
    [series, preset.bucket, monthWindow],
  );
  const monthGrowth = useMemo(
    () => (preset.bucket === 'month' ? buildMonthGrowthLabels(series, monthWindow) : []),
    [series, preset.bucket, monthWindow],
  );

  // 月度明细始终按月口径：非月视图时用近一年日序列重新归并到月
  const monthSeries = useMemo(() => {
    if (preset.bucket === 'month') return series;
    const daily = buildTrendSeries(snapshots, visibleAssets, {
      from: fromDaysAgo(RANGE_PRESETS.M.days),
      familyId,
    });
    return bucketize(daily, 'month');
  }, [preset.bucket, series, snapshots, visibleAssets, familyId]);

  const detailRows = useMemo(
    () => monthSeries.slice(-detailLimit).reverse(),
    [monthSeries, detailLimit],
  );
  // 还有更多月份可加载：当前展示的最早月早于序列中的最早月
  const detailHasMore = monthSeries.length > detailLimit;

  // 月度资产明细：点击行展开时展示当月各资产金额；与台账同口径（每月取最新快照）
  // 窗口包含基数月（buildMonthlyAssetDetails 内部 monthCount+1），用 detailLimit 保证明细覆盖展示行
  const monthlyAssetDetails = useMemo(
    () => buildMonthlyAssetDetails(visibleAssets, snapshots, new Date(), detailLimit),
    [visibleAssets, snapshots, detailLimit],
  );
  const detailAssetRows = useMemo(
    () => new Map<string, MonthAssetDetail['rows']>(monthlyAssetDetails.map((d) => [d.month, d.rows])),
    [monthlyAssetDetails],
  );

  const firstPoint = displaySeries[0];
  const lastPoint = displaySeries[displaySeries.length - 1];
  const periodDelta = firstPoint && lastPoint ? lastPoint.netWorth - firstPoint.netWorth : 0;
  const periodPct = firstPoint && lastPoint ? pctChange(lastPoint.netWorth, firstPoint.netWorth) : 0;
  const stepCount = Math.max(0, displaySeries.length - 1);
  const monthlyAvg = stepCount > 0 ? periodDelta / stepCount : 0;
  const periodUp = periodDelta >= 0;

  // 连涨月数：从末尾往前数 monthGrowth 中连续正增长的月数
  const streak = useMemo(() => {
    if (monthGrowth.length > 0) {
      let n = 0;
      for (let i = monthGrowth.length - 1; i >= 0; i--) {
        const delta = monthGrowth[i]!.delta;
        if (delta === null || delta <= 0) break;
        n += 1;
      }
      return n;
    }
    let n = 0;
    for (let i = displaySeries.length - 1; i >= 1; i--) {
      if (displaySeries[i]!.netWorth - displaySeries[i - 1]!.netWorth <= 0) break;
      n += 1;
    }
    return n;
  }, [monthGrowth, displaySeries]);

  const heroLabel = preset.bucket === 'month'
    ? (monthWindow === MONTH_WINDOW_WIDE ? '近一年累计增长（元）' : '半年累计增长（元）')
    : '区间累计增长（元）';
  const subtitle = preset.bucket === 'month'
    ? `近 ${monthWindow} 个月 · ${monthWindow === MONTH_WINDOW_WIDE ? '折叠屏' : '直板'}口径 · 单位：万元`
    : `${RANGE_HINT[range]} · ${preset.label}视图 · 单位：万元`;
  const deltaText = `${periodUp ? '+' : '-'}${amountText(Math.abs(periodDelta))}`;
  const avgText = `${monthlyAvg >= 0 ? '+' : '-'}${amountText(Math.abs(Math.round(monthlyAvg)))}`;

  const detailMax = detailRows.reduce((max, r) => Math.max(max, Math.abs(r.netWorth)), 0);
  const detailTrackWidth = Math.max(1, screenWidth - 48 - 32 - 56 - 74 - 24);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.paper }}>
      <View style={{ height: insets.top, backgroundColor: COLORS.paper }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const remaining = contentSize.height - (contentOffset.y + layoutMeasurement.height);
          if (remaining < 80 && monthSeries.length > detailLimit) {
            setDetailLimit((n) => n + DETAIL_ROWS);
          }
        }}
        scrollEventThrottle={32}
      >
        {/* 页头：标题 + 副标题 + 低调区间切换 */}
        <XStack paddingHorizontal={24} paddingTop={8} alignItems="center" justifyContent="space-between">
          <YStack flex={1} paddingRight={12}>
            <Text fontSize={21} color={COLORS.text} letterSpacing={0.8} style={SERIF_CN_TEXT}>
              净资产趋势
            </Text>
            <Text fontSize={10.5} color={COLORS.faint} letterSpacing={1} marginTop={4} numberOfLines={1}>
              {subtitle}
            </Text>
          </YStack>
          <View style={styles.segment}>
            {(Object.keys(RANGE_PRESETS) as RangeKey[]).map((k) => (
              <TouchableOpacity
                key={k}
                onPress={() => setRange(k)}
                style={[styles.segmentItem, range === k ? styles.segmentActive : null]}
                activeOpacity={0.7}
              >
                <Text
                  fontSize={9.5}
                  fontWeight={range === k ? '600' : '400'}
                  color={range === k ? COLORS.goldLight : COLORS.sub}
                >
                  {RANGE_PRESETS[k].label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </XStack>

        {/* 半年汇总 hero */}
        <View style={{ paddingHorizontal: PAGE_PAD, marginTop: 16 }}>
          <View style={styles.heroShadow}>
            <View style={[styles.hero, { width: cardWidth, height: HERO_HEIGHT }]}>
              <Svg width={cardWidth} height={HERO_HEIGHT} style={styles.heroBg} pointerEvents="none">
                <Defs>
                  <LinearGradient id="trendHeroBase" x1="0" y1="0" x2="0.55" y2="1">
                    <Stop offset="0" stopColor={GRADIENTS.hero[0]} />
                    <Stop offset="0.46" stopColor={GRADIENTS.hero[1]} />
                    <Stop offset="1" stopColor={GRADIENTS.hero[2]} />
                  </LinearGradient>
                  <RadialGradient
                    id="trendHeroGold"
                    cx="0.88"
                    cy="-0.12"
                    r="0.85"
                    gradientUnits="objectBoundingBox"
                  >
                    <Stop offset="0" stopColor={COLORS.gold} stopOpacity={0.24} />
                    <Stop offset="0.62" stopColor={COLORS.gold} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Rect x={0} y={0} width={cardWidth} height={HERO_HEIGHT} rx={HERO_RADIUS}
                  fill="url(#trendHeroBase)" />
                <Rect x={0} y={0} width={cardWidth} height={HERO_HEIGHT} rx={HERO_RADIUS}
                  fill="url(#trendHeroGold)" />
                <Circle cx={cardWidth - 41} cy={19} r={115}
                  stroke="rgba(233,220,192,0.16)" strokeWidth={1} fill="none" />
                <Circle cx={cardWidth - 56} cy={34} r={78}
                  stroke="rgba(233,220,192,0.10)" strokeWidth={1} fill="none" />
                <Circle cx={cardWidth - 79} cy={47} r={55}
                  stroke="rgba(233,220,192,0.07)" strokeWidth={1} fill="none" />
              </Svg>

              <YStack flex={1} paddingHorizontal={24} paddingTop={20} paddingBottom={20}>
                <XStack alignItems="flex-start" justifyContent="space-between">
                  <YStack flex={1}>
                    <Text fontSize={10.5} color="rgba(233,220,192,0.55)" letterSpacing={3}>
                      {heroLabel}
                    </Text>
                    <Text
                      fontSize={32}
                      lineHeight={36}
                      fontWeight="600"
                      color={COLORS.paper}
                      marginTop={8}
                      style={MONEY_TEXT}
                    >
                      {deltaText}
                    </Text>
                  </YStack>
                </XStack>

                <XStack alignItems="center" space={8} marginTop={14}>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                    stroke={COLORS.gold} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
                    <Path d="M16 7h6v6" />
                  </Svg>
                  <View style={styles.pctPill}>
                    <Text fontSize={10} color={COLORS.goldLight} style={MONEY_TEXT}>
                      {formatPct(periodPct)}
                    </Text>
                  </View>
                  <Text fontSize={11} color="rgba(233,220,192,0.62)" style={MONEY_TEXT}>
                    {preset.bucket === 'month' ? '月均' : '平均'} {avgText}
                  </Text>
                </XStack>

                <GoldHairline width={cardWidth - 48} />

                <XStack>
                  <YStack flex={1} alignItems="center">
                    <Text fontSize={9.5} color="rgba(233,220,192,0.45)" letterSpacing={2}>
                      期初 {shortDateLabel(firstPoint?.date)}
                    </Text>
                    <Text fontSize={15.5} color="rgba(242,238,226,0.72)" marginTop={4} style={MONEY_TEXT}>
                      {wanText(firstPoint?.netWorth ?? 0, 2)} 万
                    </Text>
                  </YStack>
                  <YStack flex={1} alignItems="center" style={styles.heroColDivider}>
                    <Text fontSize={9.5} color="rgba(233,220,192,0.45)" letterSpacing={2}>
                      期末 {shortDateLabel(lastPoint?.date)}
                    </Text>
                    <Text fontSize={15.5} color={COLORS.goldLight} marginTop={4} style={MONEY_TEXT}>
                      {wanText(lastPoint?.netWorth ?? 0, 2)} 万
                    </Text>
                  </YStack>
                  <YStack flex={1} alignItems="center" style={styles.heroColDivider}>
                    <Text fontSize={9.5} color="rgba(233,220,192,0.45)" letterSpacing={2}>
                      {preset.bucket === 'month' ? '连涨月数' : '连涨期数'}
                    </Text>
                    <Text fontSize={15.5} color={COLORS.paper} marginTop={4} style={MONEY_TEXT}>
                      {streak} {preset.bucket === 'month' ? '个月' : '期'}
                    </Text>
                  </YStack>
                </XStack>
              </YStack>
            </View>
          </View>
        </View>

        {/* 柱 + 环比折线组合图 */}
        <View style={{ paddingHorizontal: PAGE_PAD, marginTop: 16 }}>
          <View style={styles.card}>
            <View style={{ padding: 16 }}>
              <XStack alignItems="center" justifyContent="space-between" marginBottom={2}>
                <Text fontSize={10} color={COLORS.faint} letterSpacing={2}>
                  {displaySeries[0]?.date ?? '—'} → {displaySeries[displaySeries.length - 1]?.date ?? '—'}
                </Text>
                <XStack alignItems="center" space={12}>
                  <XStack alignItems="center" space={4}>
                    <View style={styles.legendSquare} />
                    <Text fontSize={9} color={COLORS.sub}>净资产</Text>
                  </XStack>
                  {monthGrowth.length > 0 ? (
                    <XStack alignItems="center" space={4}>
                      <View style={styles.legendLine} />
                      <Text fontSize={9} color={COLORS.sub}>环比</Text>
                    </XStack>
                  ) : null}
                </XStack>
              </XStack>

              {displaySeries.length === 0 ? (
                <View style={styles.chartEmpty}>
                  <Text fontSize={11} color={COLORS.faint}>
                    {loading ? '加载中…' : '暂无趋势数据，录入第一笔资产后即可看到'}
                  </Text>
                </View>
              ) : (
                <TrendBarChart
                  data={displaySeries}
                  growth={monthGrowth}
                  width={Math.max(1, cardWidth - 32)}
                />
              )}
            </View>
          </View>
        </View>

        {/* 月度明细（默认近 6 个月，滑到底继续加载） */}
        <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
          <XStack alignItems="baseline" justifyContent="space-between" marginBottom={8}>
            <Text fontSize={17} color={COLORS.text} letterSpacing={0.6} style={SERIF_CN_TEXT}>
              月度明细
            </Text>
          </XStack>

          <View style={styles.card}>
            <View style={{ paddingHorizontal: 16 }}>
              {detailRows.length === 0 ? (
                <Text fontSize={12} color={COLORS.faint} paddingVertical={20}>
                  {loading ? '加载中…' : '暂无月度数据'}
                </Text>
              ) : (
                detailRows.map((row, idx) => {
                  const isLatest = idx === 0;
                  const isLastRow = idx === detailRows.length - 1;
                  const isOpen = openMonth === row.date;
                  const ratio = detailMax > 0 ? Math.abs(row.netWorth) / detailMax : 0;
                  const fillWidth = Math.max(4, detailTrackWidth * ratio);
                  const assetRows = detailAssetRows.get(row.date) ?? [];
                  return (
                    <View key={row.date}>
                      <TouchableOpacity
                        activeOpacity={0.65}
                        onPress={() => setOpenMonth(isOpen ? null : row.date)}
                      >
                        <XStack
                          alignItems="center"
                          space={12}
                          paddingVertical={13}
                          borderBottomWidth={isOpen || !isLastRow ? 1 : 0}
                          borderBottomColor={COLORS.divider}
                        >
                          <Text width={56} fontSize={12} color={COLORS.sub}>{row.date}</Text>
                          <View style={styles.detailTrack}>
                            {isLatest ? (
                              <Svg width={fillWidth} height={6}>
                                <Defs>
                                  <LinearGradient id="trendDetailGold" x1="0" y1="0" x2="1" y2="0">
                                    <Stop offset="0" stopColor={COLORS.goldDeep} />
                                    <Stop offset="1" stopColor={COLORS.gold} />
                                  </LinearGradient>
                                </Defs>
                                <Rect x={0} y={0} width={fillWidth} height={6} rx={3}
                                  fill="url(#trendDetailGold)" />
                              </Svg>
                            ) : (
                              <View style={{
                                width: fillWidth,
                                height: 6,
                                borderRadius: 3,
                                backgroundColor: COLORS.ink,
                              }} />
                            )}
                          </View>
                          <Text
                            width={74}
                            textAlign="right"
                            fontSize={12}
                            fontWeight="600"
                            color={COLORS.text}
                            style={MONEY_TEXT}
                          >
                            {wanText(row.netWorth, 2)} 万
                          </Text>
                          <Svg
                            width={14}
                            height={14}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={COLORS.faint}
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}
                          >
                            <Path d="m9 18 6-6-6-6" />
                          </Svg>
                        </XStack>
                      </TouchableOpacity>

                      {/* 展开：当月各资产明细（与月度台账同口径，当月无快照的资产不展示） */}
                      {isOpen ? (
                        <View style={[
                          styles.detailExpand,
                          !isLastRow ? { borderBottomWidth: 1, borderBottomColor: COLORS.divider } : null,
                        ]}>
                          {assetRows.length === 0 ? (
                            <Text fontSize={11} color={COLORS.faint} paddingVertical={8}>
                              当月暂无资产快照
                            </Text>
                          ) : (
                            assetRows.map((r) => {
                              const tone = detailChipTone(r.asset.type);
                              const debt = r.asset.type === 'debt';
                              return (
                                <XStack key={r.asset.id} alignItems="center" space={8} paddingVertical={8}>
                                  <View style={[styles.detailChip, { backgroundColor: tone.bg }]}>
                                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                                      stroke={tone.color} strokeWidth={1.8}
                                      strokeLinecap="round" strokeLinejoin="round">
                                      {detailChipIcon(r.asset.type)}
                                    </Svg>
                                  </View>
                                  <Text flex={1} fontSize={12} color={COLORS.text} numberOfLines={1}>
                                    {r.asset.name}
                                  </Text>
                                  <Text
                                    fontSize={12}
                                    fontWeight="600"
                                    color={debt ? COLORS.danger : COLORS.text}
                                    style={MONEY_TEXT}
                                  >
                                    {debt ? '-' : ''}¥{amountText(Math.abs(r.amount))}
                                  </Text>
                                </XStack>
                              );
                            })
                          )}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>
          </View>

          <Text textAlign="center" fontSize={10} color={COLORS.faint} marginTop={16} marginBottom={8}>
            {detailHasMore ? '滑动到底加载更早 6 个月，点击行展开当月各资产' : '已展示全部月份，点击行展开当月各资产'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = {
  segment: {
    flexDirection: 'row',
    backgroundColor: COLORS.divider,
    borderRadius: 999,
    padding: 2,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
  },
  segmentItem: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  segmentActive: { backgroundColor: COLORS.ink },
  heroShadow: {
    borderRadius: HERO_RADIUS,
    backgroundColor: COLORS.inkDeep,
    shadowColor: COLORS.inkDeep,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
    elevation: 16,
  },
  hero: {
    borderRadius: HERO_RADIUS,
    overflow: 'hidden',
    backgroundColor: COLORS.ink,
  },
  heroBg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  pctPill: {
    backgroundColor: 'rgba(198,161,91,0.18)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  heroColDivider: {
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(233,220,192,0.14)',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
    shadowColor: COLORS.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  legendSquare: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: COLORS.ink,
    opacity: 0.85,
  },
  legendLine: {
    width: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: COLORS.gold,
  },
  chartEmpty: {
    height: CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.divider,
    overflow: 'hidden',
  },
  detailExpand: {
    paddingLeft: 24,
    paddingRight: 4,
    paddingBottom: 6,
  },
  detailChip: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
} as const;
