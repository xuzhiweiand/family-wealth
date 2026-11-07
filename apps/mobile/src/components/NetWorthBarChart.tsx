/**
 * 净资产柱状 + 环比金色虚线组合图（趋势页 / 年度报表共用）
 *
 * 柱高按真实净资产映射，上下留白 12%，柱顶标涨幅、柱底标数值与月份；
 * 当前期（最后一个点）用鎏金高亮，其余墨绿 85%。
 * 数据 date 为桶 key：月 'YYYY-MM' / 日 'YYYY-MM-DD' / 周 'YYYY-Www' / 年 'YYYY'。
 */

import { COLORS } from '../theme';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { TrendPoint } from '@family-wealth/shared-types';
import type { MonthGrowthLabel } from '../lib/asset-meta';

/** 组合图几何：与设计稿 330×190 的比例一致 */
export const NET_WORTH_CHART_HEIGHT = 190;
const PLOT_TOP = 34;
const PLOT_BOTTOM = 152;
const GUTTER_LEFT = 32;
const GUTTER_RIGHT = 4;
/** 环比折线的纵向区间（落在柱子上半部） */
const PCT_TOP = PLOT_TOP + 10;
const PCT_BOTTOM = PLOT_BOTTOM - 42;
/** 横轴刻度每个标签至少占的宽度，点数多时按此抽稀，避免重叠 */
const AXIS_LABEL_SLOT = 34;

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

/** 金额（分）→ 万元数值（digits 位小数） */
function wanText(cents: number, digits: number): string {
  return (cents / 1_000_000).toFixed(digits);
}

export interface NetWorthBarChartProps {
  data: readonly TrendPoint[];
  /** 与 data 按索引对齐的环比标签（pct 为 null 时柱顶显示 —） */
  growth: readonly MonthGrowthLabel[];
  width: number;
}

export function NetWorthBarChart({ data, growth, width }: NetWorthBarChartProps) {
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
    <Svg width={width} height={NET_WORTH_CHART_HEIGHT}>
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
