/**
 * 渐变卡片
 *
 * 用 react-native-svg 的 LinearGradient 画背景，避免引入
 * expo-linear-gradient（SVG 已在依赖里）。渐变 Rect 绝对定位铺满、
 * 做圆角裁剪，children 浮在上层。
 */

import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { ReactNode } from 'react';

export interface GradientCardProps {
  children: ReactNode;
  width: number;
  height: number;
  radius?: number;
  from?: string;
  to?: string;
  /** 右上角装饰圆 */
  decoration?: boolean;
}

export function GradientCard({
  children,
  width,
  height,
  radius = 24,
  from = '#10B981',
  to = '#059669',
  decoration = true,
}: GradientCardProps) {
  return (
    <View style={{ width, height, borderRadius: radius, overflow: 'hidden' }}>
      <Svg width={width} height={height} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="gcard-grad" x1="0" y1="0" x2="1" y2="1">
            <Stop stopColor={from} offset="0" />
            <Stop stopColor={to} offset="1" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} rx={radius} fill="url(#gcard-grad)" />
      </Svg>
      {decoration ? (
        <Svg width={width} height={height} style={{ position: 'absolute' }} pointerEvents="none">
          <Circle cx={width - 60} cy={-30} r={70} fill="#FFFFFF" fillOpacity={0.08} />
          <Circle cx={width - 20} cy={height + 30} r={48} fill="#FFFFFF" fillOpacity={0.08} />
        </Svg>
      ) : null}
      <View style={{ flex: 1 }} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}
