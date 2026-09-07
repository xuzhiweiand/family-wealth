/**
 * OCR 文本 → 金额候选（纯函数，可离线、可单测）
 *
 * 端侧引擎给的只是一堆「带坐标的文本行」。真正难的不是识别，
 * 而是判断「哪个数字才是余额」——银行 App 一屏里有十几个数字：
 * 卡号、日期、收益率、份额净值、广告金额……
 *
 * 策略（三层递进，命中越靠前分越高）：
 *   1. keyword        — 附近有「余额 / 总资产 / 市值」等词 → 0.55~0.90
 *   2. currency-symbol— 带 ¥ / ￥ / 元                     → ~0.45
 *   3. bare-number    — 光秃秃一个数字，只能靠位置猜        → ~0.20
 *
 * 并主动剔除三类噪声：日期、卡号/手机号、百分比；
 * 以及「收益率/涨跌幅/年化/净值」这类**看起来像金额但其实不是**的行。
 */

import type { AmountCandidate, AmountReason, OcrBlock } from './types';

/** 金额关键词 → 权重（1 = 几乎可以确定这就是要录的金额） */
export const AMOUNT_KEYWORDS: ReadonlyArray<{ readonly word: string; readonly weight: number }> = [
  { word: '账户余额', weight: 1 },
  { word: '当前余额', weight: 1 },
  { word: '可用余额', weight: 0.98 },
  { word: '总资产', weight: 0.95 },
  { word: '资产总额', weight: 0.95 },
  { word: '净资产', weight: 0.9 },
  { word: '余额', weight: 0.88 },
  { word: '持仓市值', weight: 0.88 },
  { word: '参考市值', weight: 0.85 },
  { word: '市值', weight: 0.8 },
  { word: '总额', weight: 0.7 },
  { word: '合计', weight: 0.68 },
  { word: '总计', weight: 0.68 },
  { word: '本金', weight: 0.62 },
  { word: '金额', weight: 0.6 },
  { word: '估值', weight: 0.58 },
  { word: '可用', weight: 0.5 },
] as const;

/** 负向关键词：整行命中且**没有**正向关键词时，该行的数字不可能是余额 */
export const NEGATIVE_KEYWORDS: readonly string[] = [
  '收益率',
  '涨跌幅',
  '日涨幅',
  '年化',
  '利率',
  '期限',
  '手续费',
  '份额',
  '净值',
  '占比',
  '增长率',
  '万份收益',
  '业绩比较基准',
] as const;

/** 归一化：全角数字/逗号/百分号 → 半角，压缩空白 */
export function normalizeText(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－−–—]/g, '-')
    .replace(/，/g, ',')
    .replace(/％/g, '%')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 金额模式：
 *   sign       可选负号
 *   currency   ¥ / ￥ / $
 *   digits     支持千分位与两位小数
 *   unit       亿元 / 亿 / 万元 / 万 / 元 / 圆 / 块
 */
const AMOUNT_PATTERN = /(-?)([¥￥$]?)\s*((?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d{1,2})?)\s*(亿元|亿|万元|万|元|圆|块)?/g;

export interface ParsedAmount {
  /** 单位「分」 */
  valueInCents: number;
  /** 命中的原始片段（已归一化） */
  raw: string;
  /** 在归一化文本中的起始下标 */
  start: number;
}

function unitMultiplier(unit: string | undefined): number {
  if (unit === '亿' || unit === '亿元') return 1e8;
  if (unit === '万' || unit === '万元') return 1e4;
  return 1;
}

function toCents(sign: string, digits: string, unit: string | undefined): number | null {
  const n = Number(digits.replace(/[,，\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * unitMultiplier(unit) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return sign === '-' ? -cents : cents;
}

/**
 * 从一段文本里抠出所有「像金额」的数字（已剔除百分比）。
 * 不做语义判断——那是 extractCandidates 的事。
 */
export function findAmounts(text: string): ParsedAmount[] {
  const normalized = normalizeText(text);
  const out: ParsedAmount[] = [];
  const re = new RegExp(AMOUNT_PATTERN);
  re.lastIndex = 0;
  let m: RegExpExecArray | null = re.exec(normalized);
  while (m !== null) {
    const raw = m[0];
    const after = normalized.slice(m.index + raw.length, m.index + raw.length + 1);
    // 紧跟 % 的是收益率/涨跌幅，不是金额
    if (after !== '%') {
      const valueInCents = toCents(m[1] ?? '', m[3] ?? '', m[4]);
      if (valueInCents !== null) {
        out.push({ valueInCents, raw, start: m.index });
      }
    }
    if (m.index === re.lastIndex) re.lastIndex++;
    m = re.exec(normalized);
  }
  return out;
}

/** 噪声行：日期、卡号、手机号、长串数字 —— 这些数字绝不是余额 */
export function isNoiseLine(text: string): boolean {
  if (/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(text)) return true; // 2026-09-07 / 2026年9月7日
  if (/\*{3,}/.test(text)) return true; // 6222 **** **** 1234
  if (/\d{12,}/.test(text)) return true; // 连续 12 位以上（卡号/流水号）
  if (/\b1\d{10}\b/.test(text)) return true; // 手机号
  return false;
}

/** 行内是否带货币符号 */
function hasCurrencySymbol(text: string): boolean {
  return /[¥￥]|[元圆块]\s*$/.test(text);
}

interface KeywordHit {
  word: string;
  weight: number;
}

function matchKeyword(text: string, keywords: ReadonlyArray<{ readonly word: string; readonly weight: number }>): KeywordHit | null {
  let best: KeywordHit | null = null;
  for (const { word, weight } of keywords) {
    if (text.includes(word) && (best === null || weight > best.weight)) {
      best = { word, weight };
    }
  }
  return best;
}

export interface ParseOptions {
  /** 自定义关键词表（默认 AMOUNT_KEYWORDS） */
  keywords?: ReadonlyArray<{ readonly word: string; readonly weight: number }>;
  /** 自定义负向关键词（默认 NEGATIVE_KEYWORDS） */
  negativeKeywords?: readonly string[];
  /** 是否收录「光秃秃的数字」，默认 true（分数很低，仅作兜底） */
  includeBareNumbers?: boolean;
  /** 置信度低于该值的候选直接丢掉，默认 0 */
  minScore?: number;
}

const BASE_SCORE: Record<AmountReason, number> = {
  keyword: 0.55,
  'currency-symbol': 0.45,
  'bare-number': 0.2,
};

/**
 * 从 OCR 文本块里提取金额候选，按 score 降序返回。
 *
 * @param blocks 引擎识别出的文本块（通常一行一个）
 */
export function extractCandidates(blocks: readonly OcrBlock[], options: ParseOptions = {}): AmountCandidate[] {
  const keywords = options.keywords ?? AMOUNT_KEYWORDS;
  const negativeKeywords = options.negativeKeywords ?? NEGATIVE_KEYWORDS;
  const includeBareNumbers = options.includeBareNumbers ?? true;
  const minScore = options.minScore ?? 0;

  const candidates: AmountCandidate[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const text = normalizeText(block.text);
    if (text === '') continue;
    if (isNoiseLine(text)) continue;

    const hit = matchKeyword(text, keywords);
    // 没有正向关键词、却命中负向词（收益率/净值/份额…）→ 整行跳过
    if (hit === null && negativeKeywords.some((w) => text.includes(w))) continue;

    for (const amt of findAmounts(text)) {
      const hasSymbol = hasCurrencySymbol(amt.raw) || hasCurrencySymbol(text);
      let reason: AmountReason;
      if (hit !== null) reason = 'keyword';
      else if (hasSymbol) reason = 'currency-symbol';
      else reason = 'bare-number';

      if (reason === 'bare-number' && !includeBareNumbers) continue;

      const weight = hit === null ? 0 : hit.weight;
      const base = reason === 'keyword' ? BASE_SCORE.keyword + 0.35 * weight : BASE_SCORE[reason];
      const score = base * (0.8 + 0.2 * clamp01(block.confidence));
      if (score < minScore) continue;

      const key = `${amt.valueInCents}|${hit?.word ?? ''}|${block.bbox.x},${block.bbox.y}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        valueInCents: amt.valueInCents,
        raw: amt.raw,
        keyword: hit?.word ?? null,
        score,
        reason,
        block,
      });
    }
  }

  // score 降序；同分按屏幕位置从上到下、从左到右
  return candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.block.bbox.y !== b.block.bbox.y) return a.block.bbox.y - b.block.bbox.y;
    return a.block.bbox.x - b.block.bbox.x;
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
