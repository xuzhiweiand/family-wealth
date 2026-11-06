/**
 * v0.6.0 字体基准
 *
 * 独立于 theme.ts：这里依赖 react-native 的 Platform，而 theme.ts 会被
 * tamagui.config.ts 在构建期静态求值（不能引入 react-native）。
 */
import { Platform } from 'react-native';
import type { TextStyle } from 'react-native';

/** 鸿蒙设备自带书宋（中文衬线），Georgia/Songti 在鸿蒙上不可用 */
const HARMONY_SERIF = 'ShuS-SC';
const isHarmony = (Platform.OS as string) === 'harmony';

export const FONT = {
  /** 金额 / 西文数字：衬线 */
  display: isHarmony
    ? HARMONY_SERIF
    : Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  /** 中文大标题点睛：宋体 */
  serifCn: isHarmony
    ? HARMONY_SERIF
    : Platform.select({ ios: 'Songti SC', android: 'serif', default: 'serif' }),
} as const;

/** 金额文本样式（衬线 + 等宽数字） */
export const MONEY_TEXT: TextStyle = {
  fontFamily: FONT.display,
  fontVariant: ['tabular-nums'],
};

/** 中文大标题（宋体）；Tamagui 的 fontFamily 属性只接受主题令牌，这里走 style */
export const SERIF_CN_TEXT: TextStyle = {
  fontFamily: FONT.serifCn,
};
