import { createTamagui, createTheme } from 'tamagui';

/**
 * Tamagui 设计令牌
 *
 * 设计原则：
 * - 主色采用翡翠绿（#10B981），金融行业惯例（增长、安全）
 * - 债务色 #EF4444（红）
 * - 中性色基于 Tailwind gray scale
 * - 圆角 4 档（卡片、按钮、输入框、徽章）
 *
 * 注意：
 * 1. media 使用纯字面量断点对象，不要 import
 *    @tamagui/react-native-media-driver —— 其 .native 入口无法在构建期 Node
 *    求值（@tamagui/babel-plugin 静态加载配置时会报
 *    "Cannot convert undefined or null to object"）。
 * 2. tokens.size / tokens.space 必须带 `true` 默认键；tokens.radius / tokens.zIndex
 *    必须存在且键需与 size 有交集（Tamagui 1.125+ dev 期强校验，否则 Hermes 抛
 *    "Cannot convert undefined value to object"）。
 * 3. 不配置 animations：@tamagui/animations-react-native 依赖
 *    react-native-reanimated，而本工程因 Windows 长路径编译问题在原生层排除了
 *    reanimated（见 react-native.config.js）；带 reanimated 动画驱动会在 Paper
 *    架构下产生 view tag 失配并闪退。
 */

const tokens = {
  color: {
    primary: '#10B981',
    primaryDark: '#059669',
    debt: '#EF4444',
    warning: '#F59E0B',
    bgPrimary: '#FFFFFF',
    bgSecondary: '#F9FAFB',
    bgTertiary: '#F3F4F6',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    border: '#E5E7EB',
    borderStrong: '#D1D5DB',
  },
  size: {
    true: 12, // 默认尺寸（等价于 md）
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  radius: {
    sm: 6,
    md: 12,
    lg: 16,
    xl: 24,
  },
  // zIndex 为 Tamagui 必备 token 类别，且键需与 size 有交集（dev 期强校验）
  zIndex: {
    true: 0,
    sm: 100,
    md: 200,
    lg: 300,
    xl: 400,
  },
  space: {
    true: 16, // 默认间距（等价于 md）
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
};

const lightTheme = createTheme({
  background: tokens.color.bgPrimary,
  backgroundHover: tokens.color.bgTertiary,
  backgroundPress: tokens.color.bgSecondary,
  color: tokens.color.textPrimary,
  colorHover: tokens.color.textPrimary,
  borderColor: tokens.color.border,
  primary: tokens.color.primary,
});

export const config = createTamagui({
  media: {
    sm: { maxWidth: 768 },
    md: { maxWidth: 1024 },
    lg: { maxWidth: 1280 },
    xl: { maxWidth: 1536 },
  },
  themes: {
    light: lightTheme,
  },
  tokens,
  shorthands: {},
  fonts: {
    body: { size: { 1: 12, 2: 14, 3: 16, 4: 18, 5: 20, 6: 24, 7: 28, 8: 32 } },
    heading: { size: { 1: 18, 2: 20, 3: 24, 4: 28, 5: 32, 6: 40 } },
  },
  defaultFont: 'body',
  shouldAddPrefersColorThemes: false,
});

export type AppConfig = typeof config;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppConfig {}
}
