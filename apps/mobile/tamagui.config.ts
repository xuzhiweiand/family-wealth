import { createTamagui, createTheme } from 'tamagui';

/**
 * Tamagui 设计令牌
 *
 * 设计原则：
 * - 主色采用翡翠绿（#10B981），金融行业惯例（增长、安全）
 * - 债务色 #EF4444（红）
 * - 中性色基于 Tailwind gray scale
 * - 圆角 4 档（卡片、按钮、输入框、徽章）
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
  space: {
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
  // ...
});

export const config = createTamagui({
  themes: {
    light: lightTheme,
  },
  tokens,
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