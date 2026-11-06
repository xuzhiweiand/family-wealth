/**
 * v0.6.0 视觉基准「私行墨绿 × 鎏金」
 *
 * 全工程唯一的视觉事实来源：颜色、渐变、字体、圆角、阴影都从这里取，
 * 组件内不再写死十六进制。设计契约见 v0.6.0 高保真设计稿。
 *
 * 旧值映射（v0.5.0 → v0.6.0）：
 *   #10B981 ink / #059669 inkSoft / #065F46 inkDeep / #ECFDF5 inkWash
 *   #F9FAFB paper / #F3F4F6 divider / #111827 text / #6B7280 sub
 *   #9CA3AF faint / #E5E7EB hairline / #EF4444 danger / #16A34A success
 *   #F59E0B warning / #D97706 goldDeep / #7C3AED goldDeep
 */
export const COLORS = {
  // ── 墨绿主色（私人银行底色）
  ink: '#0B3D2E',
  inkDeep: '#072A1F',
  inkSoft: '#14533F',
  inkWash: '#F4F2E8',
  inkWashSoft: '#EDEAE0',

  // ── 鎏金点缀
  gold: '#C6A15B',
  goldLight: '#E9DCC0',
  goldDeep: '#A8853F',
  goldWash: '#F5EEDD',
  warmWash: '#EFEAD9',

  // ── 纸感底与卡面
  paper: '#F7F5EF',
  surface: '#FFFFFF',
  surfaceWarm: '#FBFAF6',
  hairline: '#E7E3D8',
  hairlineSoft: '#ECE8DD',
  hairlineStrong: '#D4CFC1',
  divider: '#F0EDE4',

  // ── 文字
  text: '#1C2B26',
  sub: '#75807A',
  faint: '#A8B0AA',

  // ── 语义色
  danger: '#B4453C',
  dangerWash: '#F6E7E4',
  success: '#0F7B5C',
  warning: '#B9862F',
  warningWash: '#F7EFDC',
  mintLine: '#D9D5C4',
  huaweiRed: '#CE0E2D',

  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

/** 深色 hero 上的金色装饰线 */
export const GOLD_ON_INK = 'rgba(233, 220, 192, 0.18)';
export const GOLD_DECOR = 'rgba(233, 220, 192, 0.14)';

export const GRADIENTS = {
  /** hero 卡：由亮到深的墨绿 */
  hero: ['#0E4634', '#0B3D2E', '#072A1F'] as const,
  /** 金变体（仅 hero 点缀使用） */
  gold: ['#C6A15B', '#A8853F'] as const,
};

export const RADIUS = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
} as const;

export const SHADOW = {
  card: {
    shadowColor: COLORS.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  hero: {
    shadowColor: COLORS.inkDeep,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
    elevation: 16,
  },
} as const;

/** 11 类资产的环形图 / 图例配色（低沉珠宝色，替代原高饱和霓虹色） */
export const ASSET_TYPE_PALETTE = {
  cash: '#C6A15B',
  bank_deposit: '#5F7A6E',
  stock: '#5A6E8C',
  fund: '#8A6E7C',
  wealth_management: '#4F8A7E',
  real_estate: '#A96E4F',
  vehicle: '#7A854A',
  crypto: '#B08D57',
  precious_metal: '#D8BD80',
  receivable: '#6E8C7E',
  debt: '#B4453C',
} as const;

/** A 股习惯：涨红跌绿 */
export const MARKET = {
  up: COLORS.danger,
  down: COLORS.success,
  flat: COLORS.faint,
} as const;
