/**
 * 日期轴工具
 *
 * 约定：趋势图的时间粒度是「日历日」，一律用 `YYYY-MM-DD` 字符串（dateKey）比较。
 * 全部按 UTC 计算，避免服务端/设备时区漂移导致日期轴错位。
 */

/** 日期轴上允许的最大点数（约 10 年），防止 from/to 传错生成百万级数组 */
export const MAX_TREND_POINTS = 3660;

const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 取 ISO 字符串的日历日部分。
 * '2026-09-07T23:30:00+08:00' → '2026-09-07'
 */
export function toDateKey(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

/** 'YYYY-MM-DD' → UTC 时间戳（毫秒） */
export function parseDateKey(key: string): number {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

/** UTC 时间戳（毫秒）→ 'YYYY-MM-DD' */
export function formatDateKey(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 校验日期区间跨度是否合法（不超过 maxPoints 天）。
 * 用于在真正枚举之前尽早暴露调用方传错参数。
 *
 * @throws 跨度非法时抛错
 */
export function assertValidRange(fromKey: string, toKey: string, maxPoints = MAX_TREND_POINTS): void {
  if (fromKey > toKey) return; // 空区间由调用方自己处理
  const span = Math.floor((parseDateKey(toKey) - parseDateKey(fromKey)) / DAY_MS) + 1;
  if (span > maxPoints) {
    throw new Error(`date range too large: ${span} days > ${maxPoints}`);
  }
}

/**
 * 枚举 [fromKey, toKey] 闭区间内的所有日历日（升序）。
 * fromKey > toKey 时返回空数组。
 *
 * @throws 区间超过 maxPoints 时抛错（防御调用方传错参数）
 */
export function enumerateDateKeys(fromKey: string, toKey: string, maxPoints = MAX_TREND_POINTS): string[] {
  if (fromKey > toKey) return [];
  assertValidRange(fromKey, toKey, maxPoints);
  const start = parseDateKey(fromKey);
  const end = parseDateKey(toKey);
  const span = Math.floor((end - start) / DAY_MS) + 1;
  const out: string[] = new Array(span);
  for (let i = 0; i < span; i++) {
    out[i] = formatDateKey(start + i * DAY_MS);
  }
  return out;
}
