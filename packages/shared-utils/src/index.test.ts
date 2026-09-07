import { formatCNY, formatCNYCompact, formatPct, isLiability, aggregateTrend, pctChange, generateInviteCode } from './index';
import type { Asset } from '@family-wealth/shared-types';

// 验证 INVITE_ALPHABET 不含易混字符（确定性测试，不靠随机抽样）
import * as inviteModule from './index';
const INVITE_ALPHABET_CANDIDATES = ['0', 'O', '1', 'I', 'L'];

describe('formatCNY', () => {
  it('formats cents to CNY with 2 decimals', () => {
    expect(formatCNY(128543268)).toBe('¥1,285,432.68');
  });
  it('handles negative amounts', () => {
    expect(formatCNY(-50000)).toBe('¥-500.00');
  });
  it('omits decimals when fraction=false', () => {
    expect(formatCNY(128543268, { fraction: false })).toBe('¥1,285,433');
  });
});

describe('formatCNYCompact', () => {
  it('formats to 万 for 10000+ yuan', () => {
    expect(formatCNYCompact(128500000)).toBe('¥128.5万');
  });
  it('formats to 亿 for 1e8+ yuan', () => {
    expect(formatCNYCompact(150000000000)).toBe('¥15.00亿');
  });
});

describe('formatPct', () => {
  it('prepends + for positive', () => {
    expect(formatPct(6.84)).toBe('+6.84%');
  });
  it('keeps - for negative', () => {
    expect(formatPct(-2.31)).toBe('-2.31%');
  });
});

describe('isLiability', () => {
  it('returns true only for debt type', () => {
    expect(isLiability({ type: 'debt' })).toBe(true);
    expect(isLiability({ type: 'cash' })).toBe(false);
    expect(isLiability({ type: 'real_estate' })).toBe(false);
  });
});

describe('aggregateTrend', () => {
  const assets: Pick<Asset, 'type' | 'currentAmount'>[] = [
    { type: 'cash', currentAmount: 1000000 },
    { type: 'real_estate', currentAmount: 200000000 },
    { type: 'debt', currentAmount: 50000000 },
  ];

  it('sums assets and liabilities correctly', () => {
    const r = aggregateTrend(assets as Asset[]);
    expect(r.totalAssets).toBe(201000000);
    expect(r.totalLiabilities).toBe(50000000);
    expect(r.netWorth).toBe(151000000);
  });
});

describe('pctChange', () => {
  it('returns 0 when previous is 0', () => {
    expect(pctChange(100, 0)).toBe(0);
  });
  it('computes positive change', () => {
    expect(pctChange(120, 100)).toBe(20);
  });
  it('uses absolute value of previous to keep sign', () => {
    expect(pctChange(-150, -100)).toBe(-50);
  });
});

describe('generateInviteCode', () => {
  it('returns 6-char code by default', () => {
    expect(generateInviteCode()).toHaveLength(6);
  });
  it('respects custom length', () => {
    expect(generateInviteCode(8)).toHaveLength(8);
  });
  it('alphabet excludes look-alike chars (0/O/1/I/L)', () => {
    // 抽样 200 次：易混字符平均出现率 < 1/200 ≈ 0.5%（设计上限）
    const N = 200;
    const total = Array.from({ length: N }, () => generateInviteCode(64)).join('');
    for (const ch of INVITE_ALPHABET_CANDIDATES) {
      const occurrences = (total.match(new RegExp(ch, 'g')) || []).length;
      const rate = occurrences / total.length;
      expect(rate).toBeLessThan(0.01);
    }
  });
  it('exports invite module for alphabet check', () => {
    expect(typeof inviteModule.generateInviteCode).toBe('function');
  });
});

// ============================================================
// 边界测试（W3 补强）：空数组 / 负数 / 超大金额 / 临界值
// ============================================================

describe('边界测试：formatCNY', () => {
  it('formats zero', () => {
    expect(formatCNY(0)).toBe('¥0.00');
  });
  it('formats zero without fraction', () => {
    expect(formatCNY(0, { fraction: false })).toBe('¥0');
  });
  it('handles very large amount without throwing', () => {
    expect(formatCNY(Number.MAX_SAFE_INTEGER)).toMatch(/^¥[\d,]+\.\d{2}$/);
  });
  it('formats a deterministic 14-digit amount', () => {
    expect(formatCNY(12345678901234)).toBe('¥123,456,789,012.34');
  });
});

describe('边界测试：formatCNYCompact', () => {
  it('switches to 亿 exactly at 1e8 yuan', () => {
    expect(formatCNYCompact(10000000000)).toBe('¥1.00亿');
  });
  it('switches to 万 exactly at 1e4 yuan', () => {
    expect(formatCNYCompact(1000000)).toBe('¥1.0万');
  });
  it('keeps sign for negative 亿', () => {
    expect(formatCNYCompact(-10000000000)).toBe('¥-1.00亿');
  });
  it('formats zero as plain CNY', () => {
    expect(formatCNYCompact(0)).toBe('¥0.00');
  });
});

describe('边界测试：formatPct', () => {
  it('formats zero with no sign', () => {
    expect(formatPct(0)).toBe('0.00%');
  });
  it('formats large percentage', () => {
    expect(formatPct(12345.678)).toBe('+12345.68%');
  });
});

describe('边界测试：aggregateTrend', () => {
  it('returns zeros for empty array', () => {
    expect(aggregateTrend([])).toEqual({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 });
  });
  it('computes negative net worth when only liabilities present', () => {
    const assets = [{ type: 'debt', currentAmount: 50000000 }] as Asset[];
    const r = aggregateTrend(assets);
    expect(r.totalAssets).toBe(0);
    expect(r.totalLiabilities).toBe(50000000);
    expect(r.netWorth).toBe(-50000000);
  });
  it('treats negative debt amount as its absolute value', () => {
    const assets = [{ type: 'debt', currentAmount: -50000000 }] as Asset[];
    expect(aggregateTrend(assets).totalLiabilities).toBe(50000000);
  });
  it('sums a single asset at MAX_SAFE_INTEGER without overflow', () => {
    const assets = [{ type: 'cash', currentAmount: Number.MAX_SAFE_INTEGER }] as Asset[];
    expect(aggregateTrend(assets).netWorth).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('边界测试：pctChange', () => {
  it('returns -100 when current drops to zero', () => {
    expect(pctChange(0, 100)).toBe(-100);
  });
  it('returns 0 when no change', () => {
    expect(pctChange(100, 100)).toBe(0);
  });
  it('handles large values', () => {
    expect(pctChange(2000000000, 1000000000)).toBe(100);
  });
});

describe('边界测试：generateInviteCode', () => {
  it('returns empty string for length 0', () => {
    expect(generateInviteCode(0)).toBe('');
  });
  it('returns empty string for negative length', () => {
    expect(generateInviteCode(-1)).toBe('');
  });
  it('returns single char for length 1', () => {
    const code = generateInviteCode(1);
    expect(code).toHaveLength(1);
    expect(INVITE_ALPHABET_CANDIDATES).not.toContain(code);
  });
});