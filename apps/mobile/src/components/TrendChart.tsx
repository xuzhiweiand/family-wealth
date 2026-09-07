/**
 * 趋势折线图（react-native-svg 手绘）
 *
 * 为什么不用图表库：只需要三条线 + 一个高亮末点，
 * 引第三方图表会带进一大堆 native 依赖，而 SVG 已能满足（且可被 Tamagui 主题色驱动）。
 */

import { useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text, YStack } from 'tamagui';
import type { TrendPoint } from '@family-wealth/shared-types';

export type TrendLineKey = 'netWorth' | 'totalAssets' | 'totalLiabilities';

export const TREND_LINE_COLORS: Record<TrendLineKey, string> = {
  netWorth: '#2563EB', // 净资产（主线）
  totalAssets: '#16A34A', // 总资产
  totalLiabilities: '#DC2626', // 总负债
};

const PADDING = 10;

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

export function TrendChart({
  data,
  height = 160,
  lines = ['netWorth'],
  showLastDot = true,
}: TrendChartProps) {
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.max(1, screenWidth - 32 - PADDING * 2);
  const plotHeight = Math.max(1, height - PADDING * 2);

  if (data.length === 0) {
    return (
      <YStack height={height} alignItems="center" justifyContent="center">
        <Text fontSize="$2" color="$textSecondary">
          暂无数据，录入第一笔资产后即可看到趋势
        </Text>
      </YStack>
    );
  }

  return (
    <Svg width={width} height={plotHeight}>
      {lines.map((key) => (
        <Path
          key={key}
          d={buildLinePath(
            data.map((p) => p[key]),
            width,
            plotHeight,
          )}
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
            width,
            plotHeight,
          );
          if (dot === null) return null;
          return (
            <Circle key={`dot-${key}`} cx={dot.x} cy={dot.y} r={key === 'netWorth' ? 4 : 3} fill={TREND_LINE_COLORS[key]} />
          );
        })}
    </Svg>
  );
}
