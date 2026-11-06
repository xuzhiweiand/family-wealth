/**
 * 月度增长标签轴（0.3.0）
 *
 * 渲染在 TrendChart 正下方，逐月三行：月份 / 增长值 / 增长百分比。
 * 每列的 x 坐标与 TrendChart 数据点完全对齐（同一套宽度与留白口径）。
 * 涨跌配色遵循原型：绿涨红跌（与卡片内既有的 A 股红涨口径相互独立）。
 */

import { COLORS } from '../theme';
import { useWindowDimensions, View } from 'react-native';
import { Text, YStack } from 'tamagui';
import type { MonthGrowthLabel } from '../lib/asset-meta';
import { TREND_GUTTER_LEFT, TREND_GUTTER_RIGHT, trendChartWidth } from './TrendChart';

const UP_COLOR = COLORS.inkSoft; // 涨：绿
const DOWN_COLOR = COLORS.danger; // 跌：红
const FLAT_COLOR = COLORS.faint;
const LABEL_COLOR = COLORS.sub;

function growthColor(delta: number): string {
  if (delta > 0) return UP_COLOR;
  if (delta < 0) return DOWN_COLOR;
  return FLAT_COLOR;
}

/** 超紧凑金额：+2.9万 / -800（单位元，无 ¥ 前缀，列宽有限） */
function compactDelta(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  const yuan = Math.abs(cents) / 100;
  if (yuan >= 10_000) return `${sign}${(yuan / 10_000).toFixed(1)}万`;
  return `${sign}${Math.round(yuan)}`;
}

function formatPct(pct: number, digits: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

export interface MonthGrowthAxisProps {
  items: readonly MonthGrowthLabel[];
  /** 月份文案：'month' → 05月（同年连续月份）；'ym' → 26/05（跨年） */
  labelFormat?: 'month' | 'ym';
  /** 百分比小数位：列多时用 1 位避免拥挤 */
  pctDigits?: number;
}

export function MonthGrowthAxis({
  items,
  labelFormat = 'month',
  pctDigits = 2,
}: MonthGrowthAxisProps) {
  const { width: screenWidth } = useWindowDimensions();
  if (items.length === 0) return null;

  const chartWidth = trendChartWidth(screenWidth);
  const plotWidth = Math.max(1, chartWidth - TREND_GUTTER_LEFT - TREND_GUTTER_RIGHT);
  const n = items.length;
  const colWidth = plotWidth / n;
  const xAt = (i: number) =>
    TREND_GUTTER_LEFT + (n === 1 ? plotWidth / 2 : (i / (n - 1)) * plotWidth);

  return (
    <View style={{ height: 40, marginTop: 2 }}>
      {items.map((it, i) => {
        const center = xAt(i);
        const left = Math.min(Math.max(center - colWidth / 2, 0), chartWidth - colWidth);
        const label =
          labelFormat === 'month' ? `${it.key.slice(5)}月` : it.key.slice(2).replace('-', '/');
        const color = it.delta === null ? FLAT_COLOR : growthColor(it.delta);
        return (
          <YStack
            key={it.key}
            position="absolute"
            left={left}
            width={colWidth}
            alignItems="center"
          >
            <Text fontSize={8} color={LABEL_COLOR}>{label}</Text>
            <Text fontSize={8} fontWeight="600" color={color}>
              {it.delta === null ? '—' : compactDelta(it.delta)}
            </Text>
            <Text fontSize={8} color={color}>
              {it.pct === null ? ' ' : formatPct(it.pct, pctDigits)}
            </Text>
          </YStack>
        );
      })}
    </View>
  );
}
