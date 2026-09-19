/**
 * 分类占比环形图（react-native-svg 手绘）
 *
 * 用 stroke-dasharray 画各分类弧段：一个圆周长 C，每段按 pct 占弧长，
 * 顺序累加 strokeDashoffset 定位。比 path 弧计算更短、更不容易出缝。
 */

import Svg, { Circle, G } from 'react-native-svg';
import { Text, YStack } from 'tamagui';
import type { CategorySlice } from '../lib/asset-meta';

export interface DonutChartProps {
  slices: readonly CategorySlice[];
  size?: number;
  /** 环厚度（viewBox 单位） */
  thickness?: number;
  centerTop?: string;
  centerBottom?: string;
}

const VB = 100;
const CENTER = VB / 2;
const RADIUS = 36;
const CIRC = 2 * Math.PI * RADIUS;
/** 段间留一点白缝（viewBox 单位） */
const GAP = 0.8;

export function DonutChart({
  slices,
  size = 104,
  thickness = 11,
  centerTop,
  centerBottom,
}: DonutChartProps) {
  let accum = 0;

  return (
    <YStack width={size} height={size} alignItems="center" justifyContent="center">
      <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
        <G transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {/* 底环：空数据时也有个浅圈 */}
          <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none"
            stroke="#F3F4F6" strokeWidth={thickness} />
          {slices.map((s) => {
            const len = (s.pct / 100) * CIRC;
            const visible = Math.max(0, len - GAP);
            const el = (
              <Circle
                key={s.type}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${visible} ${CIRC - visible}`}
                strokeDashoffset={-accum}
              />
            );
            accum += len;
            return el;
          })}
        </G>
      </Svg>
      <YStack position="absolute" alignItems="center">
        {centerTop ? (
          <Text fontSize="$1" color="$textTertiary">{centerTop}</Text>
        ) : null}
        {centerBottom ? (
          <Text fontSize="$2" fontWeight="700" color="$textPrimary">{centerBottom}</Text>
        ) : null}
      </YStack>
    </YStack>
  );
}
