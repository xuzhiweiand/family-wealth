/**
 * P0-1 盘点提醒：设置模型与提醒计划生成（纯函数，无平台依赖）
 *
 * 计划 = 未来若干月的「主提醒 + 重试提醒」日期链：
 * - 主提醒：每月提醒日（1-28 或每月最后一日）的设定时刻；
 * - 重试提醒：主提醒后每隔 retryIntervalDays 天一条，
 *   最晚不超过次月 10 日（RETRY_CUTOFF_DAY），也不进入下个月的主提醒时刻；
 * - 每条提醒带确定性 id（reminder:YYYY-MM:kind:YYYY-MM-DD），
 *   供 ReminderService 与原生端做 diff 调度/取消；
 * - 日期一律按用户本地时区计算，与盘点口径（inventory.monthKey）一致。
 */

export type ReminderDay = number | 'last'; // 1-28 或 'last'

export interface ReminderSettings {
  enabled: boolean;
  dayOfMonth: ReminderDay;
  hour: number; // 0-23
  minute: number; // 0-59
  retryIntervalDays: number; // >=1
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false, // 由首次引导显式开启；未授权前不打扰
  dayOfMonth: 'last',
  hour: 20,
  minute: 0,
  retryIntervalDays: 3,
};

/** 重试提醒最晚追到次月 10 日 */
export const RETRY_CUTOFF_DAY = 10;

export interface PlannedReminder {
  /** 确定性 id：reminder:<盘点月份>:<kind>:<触发日期>，用于调度 diff */
  id: string;
  fireAt: Date;
  /** 该提醒追踪的盘点月份 'YYYY-MM'（重试提醒可能落在次月） */
  month: string;
  kind: 'primary' | 'retry';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function reminderId(month: string, kind: PlannedReminder['kind'], fireAt: Date): string {
  return `reminder:${month}:${kind}:${dateKey(fireAt)}`;
}

/** 解析提醒日在某年某月的实际日期；'last' 取当月最后一天（28-31 自适应） */
export function resolveDayOfMonth(year: number, monthIndex: number, day: ReminderDay): number {
  if (day === 'last') return new Date(year, monthIndex + 1, 0).getDate();
  return day;
}

/**
 * 生成未来 monthsAhead 个月的提醒日期链（只包含晚于 from 的时刻）。
 * 返回按触发时间升序。
 */
export function buildReminderPlan(
  settings: ReminderSettings,
  from: Date = new Date(),
  monthsAhead: number = 2,
): PlannedReminder[] {
  if (!settings.enabled || monthsAhead <= 0) return [];

  const interval = Math.max(1, Math.floor(settings.retryIntervalDays));
  const out: PlannedReminder[] = [];

  for (let i = 0; i < monthsAhead; i++) {
    const year = from.getFullYear();
    const monthIndex = from.getMonth() + i;
    // 归一化跨年（monthIndex 可 >11，Date 构造器自动进位）
    const primaryDay = resolveDayOfMonth(year, monthIndex, settings.dayOfMonth);
    const primary = new Date(year, monthIndex, primaryDay, settings.hour, settings.minute, 0, 0);
    const month = `${primary.getFullYear()}-${pad2(primary.getMonth() + 1)}`;

    if (primary.getTime() > from.getTime()) {
      out.push({ id: reminderId(month, 'primary', primary), fireAt: primary, month, kind: 'primary' });
    }

    // 重试链：cap = min(次月 10 日同时刻, 次月主提醒时刻)
    const cutoff = new Date(year, monthIndex + 1, RETRY_CUTOFF_DAY, settings.hour, settings.minute, 0, 0);
    const nextPrimaryDay = resolveDayOfMonth(year, monthIndex + 1, settings.dayOfMonth);
    const nextPrimary = new Date(year, monthIndex + 1, nextPrimaryDay, settings.hour, settings.minute, 0, 0);

    const t = new Date(primary);
    t.setDate(t.getDate() + interval);
    while (t.getTime() <= cutoff.getTime() && t.getTime() < nextPrimary.getTime()) {
      if (t.getTime() > from.getTime()) {
        out.push({ id: reminderId(month, 'retry', t), fireAt: new Date(t), month, kind: 'retry' });
      }
      t.setDate(t.getDate() + interval);
    }
  }

  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

/** 容忍脏数据的设置归一化：逐字段校验，非法值回落默认 */
export function normalizeSettings(raw: unknown): ReminderSettings {
  const d = DEFAULT_REMINDER_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;

  const intIn = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

  const dayOfMonth: ReminderDay =
    r['dayOfMonth'] === 'last'
      ? 'last'
      : typeof r['dayOfMonth'] === 'number' &&
          Number.isInteger(r['dayOfMonth']) &&
          r['dayOfMonth'] >= 1 &&
          r['dayOfMonth'] <= 28
        ? r['dayOfMonth']
        : d.dayOfMonth;

  return {
    enabled: typeof r['enabled'] === 'boolean' ? r['enabled'] : d.enabled,
    dayOfMonth,
    hour: intIn(r['hour'], 0, 23, d.hour),
    minute: intIn(r['minute'], 0, 59, d.minute),
    retryIntervalDays: intIn(r['retryIntervalDays'], 1, 30, d.retryIntervalDays),
  };
}
