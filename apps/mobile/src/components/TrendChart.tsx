/**
 * 趋势折线图（react-native-svg 手绘）
 *
 * 为什么不用图表库：只需要三条线 + 一个高亮末点，
 * 引第三方图表会带进一大堆 native 依赖，而 SVG 已能满足（且可被 Tamagui 主题色驱动）。
 *
 * 0.1.3：补齐横纵坐标 —— 左侧金额刻度 + 底部日期刻度 + 水平网格线。
 */

import { useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { Text, YStack } from 'tamagui';
import { formatCNYCompact } from '@family-wealth/shared-utils';
import type { TrendPoint } from '@family-wealth/shared-types';

export type TrendLineKey = 'netWorth' | 'totalAssets' | 'totalLiabilities';

export const TREND_LINE_COLORS: Record<TrendLineKey, string> = {
  netWorth: '#10B981', // 净资产（主线，emerald）
  totalAssets: '#F59E0B', // 总资产（橙）
  totalLiabilities: '#DC2626', // 总负债（红）
};

const PADDING_TOP = 8;
const GUTTER_LEFT = 48; // 左侧金额刻度区
const GUTTER_RIGHT = 6;
const GUTTER_BOTTOM = 18; // 底部日期刻度区
const AXIS_COLOR = '#9CA3AF';
const GRID_COLOR = '#F3F4F6';

export interface TrendChartProps {
  data: readonly TrendPoint[];
  height?: number;
  /** 要画哪几条线，默认只画净资产 */
  lines?: readonly TrendLineKey[];
  /** 是否高亮最后一个点 */
  showLastDot?: boolean;
}

/** 把数值序列映射成 SVG path（min→底部，max→顶部） */
export function buildLinePath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // 全平的序列避免除零
  return values
    .map((v, i) => {
      const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

/** 最后一个点的坐标，用于画高亮圆点 */
export function lastPointPosition(
  values: readonly number[],
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = values.length === 1 ? width / 2 : width;
  const y = height - ((values[values.length - 1]! - min) / span) * height;
  return { x, y };
}

/** 轴刻度文案：日 'MM-DD' / 月 'MM' / ISO 周 'Wnn' / 年 'YYYY' */
function axisLabel(dateKey: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey.slice(5);
  if (/^\d{4}-\d{2}$/.test(dateKey)) return dateKey.slice(5);
  if (/^\d{4}-W\d{2}$/.test(dateKey)) return dateKey.slice(5);
  return dateKey;
}

const X_LABEL_COUNT = 7;
const X_LABEL_ALL_MAX = 13;

/**
 * 选要画日期刻度的点下标：点数 ≤ 13 全部标出（近一年 12 个月 → 每月一刻度）；
 * 点数多时均匀取约 X_LABEL_COUNT 个，且一定包含首末。
 */
function pickLabelIndices(n: number): number[] {
  if (n <= X_LABEL_ALL_MAX) return Array.from({ length: n }, (_, i) => i);
  const indices = new Set<number>([0, n - 1]);
  for (let i = 1; i < X_LABEL_COUNT - 1; i++) {
    indices.add(Math.round((i / (X_LABEL_COUNT - 1)) * (n - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

export function TrendChart({
  data,
  height = 160,
  lines = ['netWorth'],
  showLastDot = true,
}: TrendChartProps) {
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.max(1, screenWidth - 32 - PADDING_TOP * 2);
  const plotWidth = Math.max(1, width - GUTTER_LEFT - GUTTER_RIGHT);
  const plotHeight = Math.max(1, height - PADDING_TOP - GUTTER_BOTTOM);

  if (data.length === 0) {
    return (
      <YStack height={height} alignItems="center" justifyContent="center">
        <Text fontSize="$2" color="$textSecondary">
          暂无数据，录入第一笔资产后即可看到趋势
        </Text>
      </YStack>
    );
  }

  // 所有绘制线的值域，统一决定 Y 轴刻度
  const allValues = data.flatMap((p) => lines.map((k) => p[k]));
  if (allValues.length === 0) {
    return (
      <YStack height={height} alignItems="center" justifyContent="center">
        <Text fontSize="$2" color="$textSecondary">暂无可展示的指标</Text>
      </YStack>
    );
  }
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min;
  const yOf = (v: number) => PADDING_TOP + plotHeight - ((v - min) / (span || 1)) * plotHeight;
  const ticks: number[] = span === 0 ? [max] : [max, (max + min) / 2, min];

  const pointCount = data.length;
  const labelIndices = pickLabelIndices(pointCount);
  const xAt = (i: number) =>
    GUTTER_LEFT + (pointCount === 1 ? plotWidth / 2 : (i / (pointCount - 1)) * plotWidth);

  return (
    <Svg width={width} height={height}>
      {/* Y 轴网格线 + 金额刻度 */}
      {ticks.map((t, i) => (
        <Line
          key={`grid-${i}`}
          x1={GUTTER_LEFT}
          x2={GUTTER_LEFT + plotWidth}
          y1={yOf(t)}
          y2={yOf(t)}
          stroke={GRID_COLOR}
          strokeWidth={1}
        />
      ))}
      {ticks.map((t, i) => (
        <SvgText
          key={`ytick-${i}`}
          x={GUTTER_LEFT - 6}
          y={yOf(t) + 3}
          fontSize={9}
          fill={AXIS_COLOR}
          textAnchor="end"
        >
          {formatCNYCompact(Math.round(t))}
        </SvgText>
      ))}

      {/* 折线（在绘图区内平移） */}
      <G transform={`translate(${GUTTER_LEFT}, 0)`}>
        {lines.map((key) => (
          <Path
            key={key}
            d={buildLinePath(
              data.map((p) => p[key]),
              plotWidth,
              plotHeight,
            )}
            transform={`translate(0, ${PADDING_TOP})`}
            fill="none"
            stroke={TREND_LINE_COLORS[key]}
            strokeWidth={key === 'netWorth' ? 2.5 : 1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {lines
          .filter((key) => showLastDot)
          .map((key) => {
            const dot = lastPointPosition(
              data.map((p) => p[key]),
              plotWidth,
              plotHeight,
            );
            if (dot === null) return null;
            return (
              <Circle
                key={`dot-${key}`}
                cx={dot.x}
                cy={dot.y + PADDING_TOP}
                r={key === 'netWorth' ? 4 : 3}
                fill={TREND_LINE_COLORS[key]}
              />
            );
          })}
      </G>

      {/* X 轴日期刻度：按月/粒度均匀标注，首末贴边 */}
      {labelIndices.map((i) => {
        const anchor: 'start' | 'middle' | 'end' =
          pointCount === 1 ? 'middle' : i === 0 ? 'start' : i === pointCount - 1 ? 'end' : 'middle';
        return (
          <SvgText
            key={`xlabel-${i}`}
            x={xAt(i)}
            y={height - 5}
            fontSize={9}
            fill={AXIS_COLOR}
            textAnchor={anchor}
          >
            {axisLabel(data[i]!.date)}
          </SvgText>
        );
      })}
    </Svg>
  );
}
