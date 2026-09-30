import type { Asset, AssetSnapshot, AssetType, Visibility } from '@family-wealth/shared-types';
import { ReminderService, StubReminderBackend } from '../services/reminder-service';
import { saveReminderSettings, loadReminderSettings } from '../services/reminder-settings';
import AsyncStorage from '@react-native-async-storage/async-storage';

const USER = 'user-1';
const OTHER = 'user-2';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    familyId: 'fam-1',
    ownerId: USER,
    type: 'bank_deposit' as AssetType,
    name: '测试账户',
    currentAmount: 100_000,
    currency: 'CNY',
    visibility: 'family' as Visibility,
    details: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeSnapshot(assetId: string, capturedAt: string): AssetSnapshot {
  return {
    id: `snap-${assetId}-${capturedAt}`,
    assetId,
    familyId: 'fam-1',
    amount: 100_000,
    currency: 'CNY',
    capturedAt,
    source: 'manual',
  };
}

// 每次测试前重置 AsyncStorage，隔离状态
beforeEach(async () => {
  await (AsyncStorage as any).__reset();
});

describe('ReminderService（编排层）', () => {
  it('设置未启用时不调度任何提醒', async () => {
    const svc = new ReminderService();
    const stub = new StubReminderBackend();
    svc.backend = stub;
    await svc.refresh([makeAsset()], [], USER);
    expect(stub.scheduled.size).toBe(0);
  });

  it('启用后：未完成盘点 → 调度未来 N 个月的主提醒和重试', async () => {
    await saveReminderSettings({
      enabled: true,
      dayOfMonth: 15,
      hour: 20,
      minute: 0,
      retryIntervalDays: 3,
    });
    const svc = new ReminderService();
    const stub = new StubReminderBackend();
    svc.backend = stub;
    await svc.refresh([makeAsset()], [], USER);
    // monthsAhead=3；若当月提醒日已过则当月主提醒被过滤，至少还有 2 个未来主提醒
    const ids = svc.getScheduledIds();
    const primaries = ids.filter((id) => id.includes('primary'));
    expect(primaries.length).toBeGreaterThanOrEqual(2);
    expect(stub.scheduled.size).toBeGreaterThan(0);
  });

  it('当月已完成盘点时，当月主提醒被过滤，但仍调度后续月份', async () => {
    // 设置每月 15 日提醒
    await saveReminderSettings({
      enabled: true,
      dayOfMonth: 15,
      hour: 20,
      minute: 0,
      retryIntervalDays: 3,
    });
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const a = makeAsset();
    const snap = makeSnapshot(a.id, now.toISOString()); // 当月快照

    const svc = new ReminderService();
    const stub = new StubReminderBackend();
    svc.backend = stub;
    await svc.refresh([a], [snap], USER);

    // 当月主提醒被过滤，但次月、下下月仍存在
    const ids = svc.getScheduledIds();
    expect(ids.every((id) => !id.includes(currentMonth))).toBe(true);
    const future = ids.filter((id) => !id.includes(currentMonth));
    expect(future.length).toBeGreaterThan(0);
  });

  it('设置变更后立即重新调度（diff）', async () => {
    await saveReminderSettings({
      enabled: true,
      dayOfMonth: 15,
      hour: 20,
      minute: 0,
      retryIntervalDays: 3,
    });
    const svc = new ReminderService();
    const stub = new StubReminderBackend();
    svc.backend = stub;
    await svc.refresh([makeAsset()], [], USER);
    const firstIds = new Set(svc.getScheduledIds());

    // 修改提醒日为 20 日 → 全部 ID 应变化
    await svc.updateSettings({
      enabled: true,
      dayOfMonth: 20,
      hour: 21,
      minute: 0,
      retryIntervalDays: 3,
    });
    const secondIds = new Set(svc.getScheduledIds());
    // 应有新增（新日期）和取消（旧日期）
    expect([...secondIds].some((id) => !firstIds.has(id))).toBe(true);
  });

  it('登出时取消全部提醒', async () => {
    await saveReminderSettings({
      enabled: true,
      dayOfMonth: 15,
      hour: 20,
      minute: 0,
      retryIntervalDays: 3,
    });
    const svc = new ReminderService();
    const stub = new StubReminderBackend();
    svc.backend = stub;
    await svc.refresh([makeAsset()], [], USER);
    expect(stub.scheduled.size).toBeGreaterThan(0);

    await svc.onLogout();
    expect(stub.scheduled.size).toBe(0);
    expect(svc.getScheduledIds()).toEqual([]);
  });

  it('App 回前台时重新对齐调度（模拟时间跨天）', async () => {
    await saveReminderSettings({
      enabled: true,
      dayOfMonth: 15,
      hour: 20,
      minute: 0,
      retryIntervalDays: 3,
    });
    const svc = new ReminderService();
    const stub = new StubReminderBackend();
    svc.backend = stub;
    await svc.refresh([makeAsset()], [], USER);
    const before = svc.getScheduledIds();

    // 用户完成盘点 → 触发回前台
    const now = new Date();
    const snap = makeSnapshot('asset-1', now.toISOString());
    await svc.onAppForeground([makeAsset()], [snap], USER);

    // 当月已完成 → 调度集合应变（当月 ID 被过滤）
    const after = svc.getScheduledIds();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(after.every((id) => !id.includes(currentMonth))).toBe(true);
  });
});
