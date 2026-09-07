import { AMOUNT_KEYWORDS, NEGATIVE_KEYWORDS, extractCandidates, findAmounts, isNoiseLine, normalizeText } from '../parse';
import type { OcrBlock } from '../types';

function block(text: string, y = 0, confidence = 0.9): OcrBlock {
  return { text, bbox: { x: 0, y, width: 200, height: 24 }, confidence };
}

describe('normalizeText', () => {
  it('converts full-width digits and punctuation', () => {
    expect(normalizeText('￥１２，３４５')).toBe('￥12,345');
  });

  it('compresses whitespace and trims', () => {
    expect(normalizeText('  余额   100  ')).toBe('余额 100');
  });

  it('normalizes dashes and percent sign', () => {
    expect(normalizeText('－１００％')).toBe('-100%');
  });
});

describe('findAmounts', () => {
  it('parses a plain decimal with currency symbol', () => {
    expect(findAmounts('¥1,285,432.68')[0]!.valueInCents).toBe(128_543_268);
  });

  it('parses 元 suffix', () => {
    expect(findAmounts('1,285,432.68 元')[0]!.valueInCents).toBe(128_543_268);
  });

  it('parses 万 unit', () => {
    // 128.5万 = 1,285,000 元 = 128,500,000 分
    expect(findAmounts('128.5万')[0]!.valueInCents).toBe(128_500_000);
  });

  it('parses 万元 unit', () => {
    expect(findAmounts('12.34万元')[0]!.valueInCents).toBe(12_340_000);
  });

  it('parses 亿 unit', () => {
    // 1.2亿 = 120,000,000 元 = 12,000,000,000 分
    expect(findAmounts('1.2亿')[0]!.valueInCents).toBe(12_000_000_000);
  });

  it('parses 亿元 unit', () => {
    expect(findAmounts('1.2亿元')[0]!.valueInCents).toBe(12_000_000_000);
  });

  it('keeps negative amounts (负债可能是负数)', () => {
    expect(findAmounts('-500')[0]!.valueInCents).toBe(-50_000);
  });

  it('skips percentages', () => {
    expect(findAmounts('3.5%')).toEqual([]);
    expect(findAmounts('收益率 3.5%')).toEqual([]);
  });

  it('finds several amounts in one line', () => {
    const found = findAmounts('转入 100.00 转出 200.00');
    expect(found.map((f) => f.valueInCents)).toEqual([10_000, 20_000]);
  });

  it('returns empty for text without digits', () => {
    expect(findAmounts('暂无资产')).toEqual([]);
  });

  it('rejects amounts that overflow safe integer range', () => {
    expect(findAmounts('99999999999999999')).toEqual([]);
  });

  it('returns the raw matched snippet for UI review', () => {
    expect(findAmounts('余额 ¥88.88')[0]!.raw).toContain('88.88');
  });
});

describe('isNoiseLine', () => {
  it('detects dates', () => {
    expect(isNoiseLine('2026-09-07')).toBe(true);
    expect(isNoiseLine('交易时间 2026/09/07 10:22')).toBe(true);
    expect(isNoiseLine('2026年9月7日')).toBe(true);
  });

  it('detects masked card numbers', () => {
    expect(isNoiseLine('6222 **** **** 1234')).toBe(true);
  });

  it('detects long digit runs', () => {
    expect(isNoiseLine('流水号 123456789012345')).toBe(true);
  });

  it('detects phone numbers', () => {
    expect(isNoiseLine('客服 13800138000')).toBe(true);
  });

  it('does not flag normal amounts', () => {
    expect(isNoiseLine('账户余额 ¥1,234.56')).toBe(false);
  });
});

describe('extractCandidates', () => {
  it('returns empty for no blocks', () => {
    expect(extractCandidates([])).toEqual([]);
  });

  it('ignores blocks without any amount', () => {
    const result = extractCandidates([block('招商银行'), block('储蓄卡')]);
    expect(result).toEqual([]);
  });

  it('ranks keyword hits above everything else', () => {
    const result = extractCandidates([
      block('   1,000.00', 10), // 裸数字
      block('账户余额 ¥88,888.88', 50),
      block('¥777.00', 90),
    ]);
    expect(result[0]!.keyword).toBe('账户余额');
    expect(result[0]!.valueInCents).toBe(8_888_888);
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });

  it('labels reasons correctly', () => {
    const result = extractCandidates([
      block('账户余额 ¥1,000.00', 0),
      block('¥2,000.00', 30),
      block('3,000.00', 60),
    ]);
    expect(result.map((c) => c.reason)).toEqual(['keyword', 'currency-symbol', 'bare-number']);
  });

  it('skips date and card-number lines', () => {
    const result = extractCandidates([
      block('2026-09-07'),
      block('6222 **** **** 1234'),
      block('账户余额 ¥1,000.00'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.raw).toContain('1,000.00');
  });

  it('skips lines that only have negative keywords', () => {
    const result = extractCandidates([
      block('七日年化 2.35%'),
      block('涨跌幅 3.21'),
      block('万份收益 0.58'),
    ]);
    expect(result).toEqual([]);
  });

  it('still extracts when a positive keyword coexists with a negative one', () => {
    const result = extractCandidates([block('持仓市值 12,345.67 收益率 3.5%')]);
    expect(result[0]!.keyword).toBe('持仓市值');
    expect(result[0]!.valueInCents).toBe(1_234_567);
  });

  it('can drop bare numbers entirely', () => {
    const withBare = extractCandidates([block('1,000.00')]);
    const withoutBare = extractCandidates([block('1,000.00')], { includeBareNumbers: false });
    expect(withBare).toHaveLength(1);
    expect(withoutBare).toHaveLength(0);
  });

  it('supports a custom keyword table', () => {
    const custom = [{ word: '冻结金额', weight: 1 }];
    const result = extractCandidates([block('冻结金额 ¥5.00')], { keywords: custom });
    expect(result[0]!.keyword).toBe('冻结金额');
  });

  it('supports custom negative keywords', () => {
    const result = extractCandidates([block('积分 500')], { negativeKeywords: ['积分'] });
    expect(result).toEqual([]);
  });

  it('honours minScore', () => {
    const result = extractCandidates([block('账户余额 ¥1,000.00'), block('1,500.00')], { minScore: 0.5 });
    expect(result).toHaveLength(1);
    expect(result[0]!.reason).toBe('keyword');
  });

  it('deduplicates identical amounts from the same position', () => {
    const b = block('账户余额 ¥1,000.00', 0);
    const result = extractCandidates([b, { ...b }]);
    expect(result).toHaveLength(1);
  });

  it('sorts same-score candidates top-to-bottom then left-to-right', () => {
    const result = extractCandidates([
      block('¥500.00', 100),
      block('¥500.00', 20),
    ]);
    expect(result.map((c) => c.block.bbox.y)).toEqual([20, 100]);
  });

  it('prefers the strongest keyword when several match', () => {
    // 「余额」0.88 vs 「可用」0.5 —— 同一行两个词都命中时应取权重更高的
    const result = extractCandidates([block('可用余额 ¥1,000.00')]);
    expect(result[0]!.keyword).toBe('可用余额');
  });

  it('exposes the source block for UI highlighting', () => {
    const b = block('账户余额 ¥1,000.00', 42);
    const result = extractCandidates([b]);
    expect(result[0]!.block.bbox.y).toBe(42);
  });

  it('lowers score when engine confidence is low', () => {
    const high = extractCandidates([block('账户余额 ¥1,000.00', 0, 1)]);
    const low = extractCandidates([block('账户余额 ¥1,000.00', 0, 0.2)]);
    expect(high[0]!.score).toBeGreaterThan(low[0]!.score);
  });

  it('ships a keyword table that covers the common banking wording', () => {
    const words = AMOUNT_KEYWORDS.map((k) => k.word);
    for (const w of ['余额', '总资产', '市值', '合计']) {
      expect(words).toContain(w);
    }
    expect(NEGATIVE_KEYWORDS).toContain('收益率');
  });
});
