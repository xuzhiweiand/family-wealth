import {
  buildReminderPlan,
  DEFAULT_REMINDER_SETTINGS,
  normalizeSettings,
  resolveDayOfMonth,
  RETRY_CUTOFF_DAY,
  type ReminderSettings,
} from '../lib/reminder-plan';

const ENABLED: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, enabled: true };

// 固定「现在」为 2026-09-15 12:00，断言不依赖运行日期
const FROM = new Date(2026, 8, 15, 12, 0, 0);

describe('resolveDayOfMonth', () => {
  it("'last' 自适应各月天数（31/30/29/28）", () => {
    expect(resolveDayOfMonth(2026, 0, 'last')).toBe(31); // 1 月
    expect(resolveDayOfMonth(2026, 8, 'last')).toBe(30); // 9 月
    expect(resolveDayOfMonth(2028, 1, 'last')).toBe(29); // 闰年 2 月
    expect(resolveDayOfMonth(2026, 1, 'last')).toBe(28); // 平年 2 月
  });

  it('数字日原样返回', () => {
    expect(resolveDayOfMonth(2026, 8, 15)).toBe(15);
  });
});

describe('buildReminderPlan', () => {
  it('enabled=false 时不生成任何提醒', () => {
    expect(buildReminderPlan(DEFAULT_REMINDER_SETTINGS, FROM, 3)).toEqual([]);
  });

  it('monthsAhead<=0 时不生成任何提醒', () => {
    expect(buildReminderPlan(ENABLED, FROM, 0)).toEqual([]);
  });

  it('默认设置：主提醒落在每月最后一日 20:00', () => {
    const plan = buildReminderPlan(ENABLED, FROM, 2);
    const primaries = plan.filter((p) => p.kind === 'primary');
    expect(primaries.map((p) => p.fireAt)).toEqual([
      new Date(2026, 8, 30, 20, 0, 0), // 9 月 30 日
      new Date(2026, 9, 31, 20, 0, 0), // 10 月 31 日
    ]);
    expect(primaries.map((p) => p.month)).toEqual(['2026-09', '2026-10']);
  });

  it('默认设置：每 3 日重试，最晚追到次月 10 日', () => {
    const plan = buildReminderPlan(ENABLED, FROM, 1);
    const retries = plan.filter((p) => p.kind === 'retry');
    // 9/30 +3 → 10/3, 10/6, 10/9；10/12 超过次月 10 日截止
    expect(retries.map((p) => p.fireAt)).toEqual([
      new Date(2026, 9, 3, 20, 0, 0),
      new Date(2026, 9, 6, 20, 0, 0),
      new Date(2026, 9, 9, 20, 0, 0),
    ]);
    // 重试归属被追踪的盘点月份（9 月），而非触发所在月
    expect(retries.every((p) => p.month === '2026-09')).toBe(true);
  });

  it('重试时刻等于次月截止日当天允许触发（含边界）', () => {
    // 主提醒 9/28，间隔 3：9/28 → 10/1, 10/4, 10/7, 10/10（含），10/13 排除
    const s: ReminderSettings = { ...ENABLED, dayOfMonth: 28 };
    const plan = buildReminderPlan(s, FROM, 1);
    const retries = plan.filter((p) => p.kind === 'retry');
    expect(retries.map((p) => p.fireAt.getDate())).toEqual([1, 4, 7, RETRY_CUTOFF_DAY]);
  });

  it('重试不会与次月主提醒重叠', () => {
    // 主提醒日=1、间隔 1：9 月重试链逐日推进，到达 10/1 主提醒前必须停止
    const s: ReminderSettings = { ...ENABLED, dayOfMonth: 1, retryIntervalDays: 1 };
    const plan = buildReminderPlan(s, new Date(2026, 8, 2, 12), 2); // 9/2 起，覆盖 9、10 月
    const sepRetries = plan.filter((p) => p.month === '2026-09' && p.kind === 'retry');
    const octPrimary = plan.find((p) => p.month === '2026-10' && p.kind === 'primary')!;
    expect(octPrimary).toBeDefined();
    expect(sepRetries.length).toBeGreaterThan(0);
    expect(sepRetries.every((p) => p.fireAt.getTime() < octPrimary.fireAt.getTime())).toBe(true);
  });

  it('过去的时刻被过滤：主提醒已过则只保留其重试链中的未来项', () => {
    // from = 9/30 21:00，主提醒 20:00 已过 → 不含；重试 10/3 起保留
    const lateFrom = new Date(2026, 8, 30, 21, 0, 0);
    const plan = buildReminderPlan(ENABLED, lateFrom, 1);
    expect(plan.find((p) => p.kind === 'primary')).toBeUndefined();
    expect(plan[0]!.fireAt).toEqual(new Date(2026, 9, 3, 20, 0, 0));
    expect(plan.every((p) => p.fireAt.getTime() > lateFrom.getTime())).toBe(true);
  });

  it('from 恰好等于触发时刻时该条被过滤（严格大于）', () => {
    const exact = new Date(2026, 8, 30, 20, 0, 0);
    const plan = buildReminderPlan(ENABLED, exact, 1);
    expect(plan.find((p) => p.kind === 'primary')).toBeUndefined();
  });

  it('跨年月份归一化：12 月主提醒的重试落在次年 1 月', () => {
    const decFrom = new Date(2026, 11, 15, 12, 0, 0);
    const plan = buildReminderPlan(ENABLED, decFrom, 2);
    const primaries = plan.filter((p) => p.kind === 'primary');
    expect(primaries.map((p) => p.month)).toEqual(['2026-12', '2027-01']);
    const decRetries = plan.filter((p) => p.month === '2026-12' && p.kind === 'retry');
    // 12/31 +3 → 次年 1/3, 1/6, 1/9
    expect(decRetries[0]!.fireAt).toEqual(new Date(2027, 0, 3, 20, 0, 0));
  });

  it('id 确定且可区分月份/kind/日期（供调度 diff）', () => {
    const a = buildReminderPlan(ENABLED, FROM, 2);
    const b = buildReminderPlan(ENABLED, FROM, 2);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(new Set(a.map((p) => p.id)).size).toBe(a.length); // 无重复
    expect(a[0]!.id).toBe('reminder:2026-09:primary:2026-09-30');
  });

  it('结果按触发时间升序', () => {
    const plan = buildReminderPlan(ENABLED, FROM, 3);
    const times = plan.map((p) => p.fireAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });
});

describe('normalizeSettings', () => {
  it('非对象/空值回落全量默认', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it('合法字段保留，非法字段逐项回落默认', () => {
    expect(
      normalizeSettings({
        enabled: true,
        dayOfMonth: 15,
        hour: 99, // 非法
        minute: 30,
        retryIntervalDays: 0, // 非法（<1）
      }),
    ).toEqual({
      enabled: true,
      dayOfMonth: 15,
      hour: DEFAULT_REMINDER_SETTINGS.hour,
      minute: 30,
      retryIntervalDays: DEFAULT_REMINDER_SETTINGS.retryIntervalDays,
    });
  });

  it('dayOfMonth 只接受 1-28 或 last', () => {
    expect(normalizeSettings({ dayOfMonth: 'last' }).dayOfMonth).toBe('last');
    expect(normalizeSettings({ dayOfMonth: 28 }).dayOfMonth).toBe(28);
    expect(normalizeSettings({ dayOfMonth: 29 }).dayOfMonth).toBe(DEFAULT_REMINDER_SETTINGS.dayOfMonth);
    expect(normalizeSettings({ dayOfMonth: 0 }).dayOfMonth).toBe(DEFAULT_REMINDER_SETTINGS.dayOfMonth);
  });

  it('retryIntervalDays 上限 30，hour/minute 边界合法', () => {
    expect(normalizeSettings({ retryIntervalDays: 31 }).retryIntervalDays).toBe(3);
    expect(normalizeSettings({ hour: 23, minute: 59 })).toMatchObject({ hour: 23, minute: 59 });
  });
});
