import { LIABILITY_TYPES, type Asset, type TrendPoint } from '@family-wealth/shared-types';

/**
 * 金额格式化：¥1,285,432.68
 * 金额统一以「分」为整数单位存储，展示时除以 100。
 */
/** 千分位分组（Hermes 的 toLocaleString 不保证输出分组分隔符，这里手动实现） */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCNY(amountInCents: number, options?: { fraction?: boolean }): string {
  const fraction = options?.fraction ?? true;
  const negative = amountInCents < 0;
  const abs = Math.abs(amountInCents);

  // fraction=false 时四舍五入到元；fraction=true 时精确到分
  const yuan = fraction ? Math.floor(abs / 100) : Math.round(abs / 100);
  const cents = abs % 100;

  const intText = groupThousands(String(yuan));
  const decimalText = fraction ? `.${String(cents).padStart(2, '0')}` : '';
  return `¥${negative ? '-' : ''}${intText}${decimalText}`;
}

/** 紧凑格式：¥128.5万 / ¥1.2亿（图表轴、卡片用） */
export function formatCNYCompact(amountInCents: number): string {
  const yuan = amountInCents / 100;
  if (Math.abs(yuan) >= 1_0000_0000) return `¥${(yuan / 1_0000_0000).toFixed(2)}亿`;
  if (Math.abs(yuan) >= 1_0000) return `¥${(yuan / 1_0000).toFixed(1)}万`;
  return formatCNY(amountInCents);
}

/** 变化百分比：+6.84% / -2.31% */
export function formatPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** 判断资产是否为负债（净资产计算中做减项） */
export function isLiability(asset: Pick<Asset, 'type'>): boolean {
  return LIABILITY_TYPES.includes(asset.type);
}

/** 按快照/资产列表聚合出趋势三线：总资产、总债务、净资产 */
export function aggregateTrend(assets: Asset[]): Pick<TrendPoint, 'totalAssets' | 'totalLiabilities' | 'netWorth'> {
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const a of assets) {
    if (isLiability(a)) totalLiabilities += Math.abs(a.currentAmount);
    else totalAssets += a.currentAmount;
  }
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

/** 计算环比变化百分比（保留两位小数） */
export function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** 生成 62 进制家庭邀请码（如 X7K9M2） */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去除易混淆字符：0/O/1/I/L
export function generateInviteCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  }
  return code;
}
