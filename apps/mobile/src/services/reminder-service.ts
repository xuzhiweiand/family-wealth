/**
 * P0-1 月末盘点提醒：调度编排层（ReminderService）。
 *
 * 职责：
 * 1. 加载/保存设置（委托 reminder-settings）；
 * 2. 基于盘点完成度与设置生成提醒计划，并与原生端做 diff 调度；
 * 3. 提供五个业务触发钩子（登录后、快照增删改、同步pull后、App回前台、设置变更）；
 * 4. 登出时取消全部提醒。
 *
 * 注意：这是一个带状态的异步编排对象，不接入 zustand（状态为调度副作用，非 UI 状态）。
 */

import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';
import { getInventoryStatus } from '../lib/inventory';
import {
  buildReminderPlan,
  type PlannedReminder,
  type ReminderSettings,
} from '../lib/reminder-plan';
import { loadReminderSettings, saveReminderSettings } from './reminder-settings';

// ---------- 平台抽象（将在 T4 Android / T6 鸿蒙实现具体后端） ----------

export interface ReminderBackend {
  requestPermission(): Promise<boolean>;
  /** 查询当前权限状态（设置页展示用） */
  getPermissionStatus(): Promise<'granted' | 'denied' | 'unknown'>;
  /** 跳转系统通知设置页（权限被拒时引导） */
  openSystemSettings(): Promise<void>;
  /** 返回值表示原生端是否确认调度成功 */
  schedule(id: string, fireAt: Date, title: string, body: string): Promise<boolean>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  /** 查询已调度的提醒 id 列表（鸿蒙端用于启动时 diff 校验） */
  getScheduledIds?(): Promise<string[]>;
}

// ---------- 占位实现（jest 中注入 StubBackend 做隔离测试） ----------

export class StubReminderBackend implements ReminderBackend {
  scheduled = new Set<string>();

  async requestPermission(): Promise<boolean> {
    return true;
  }
  async getPermissionStatus(): Promise<'granted' | 'denied' | 'unknown'> {
    return 'granted';
  }
  async openSystemSettings(): Promise<void> {}
  async schedule(id: string): Promise<boolean> {
    this.scheduled.add(id);
    return true;
  }
  async cancel(id: string): Promise<void> {
    this.scheduled.delete(id);
  }
  async cancelAll(): Promise<void> {
    this.scheduled.clear();
  }
  async getScheduledIds(): Promise<string[]> {
    return Array.from(this.scheduled);
  }
}

// ---------- 业务常量 ----------

const PLAN_MONTHS_AHEAD = 3;
const NOTIFICATION_TITLE = '家资提醒';
const NOTIFICATION_BODY = '本月资产盘点还未完成，花 3 分钟更新账户余额吧';

// ---------- ReminderService ----------

export class ReminderService {
  private settings: ReminderSettings | null = null;
  private desired: PlannedReminder[] = [];
  private scheduled = new Set<string>(); // 原生端已确认调度的 id
  private _backend: ReminderBackend | null = null;

  set backend(b: ReminderBackend) {
    this._backend = b;
  }

  /** 惰性初始化（首次调用时加载设置） */
  async init(): Promise<void> {
    if (this.settings === null) {
      this.settings = await loadReminderSettings();
    }
  }

  /** 获取当前设置（只读副本） */
  getSettings(): ReminderSettings | null {
    return this.settings ? { ...this.settings } : null;
  }

  /** 获取当前计划（供 UI 展示「下次提醒」） */
  getPlannedReminders(): readonly PlannedReminder[] {
    return this.desired;
  }

  /** 获取已调度 id 的快照（测试/调试用） */
  getScheduledIds(): readonly string[] {
    return Array.from(this.scheduled);
  }

  /** 更新设置并立即刷新 */
  async updateSettings(next: ReminderSettings): Promise<void> {
    this.settings = { ...next };
    await saveReminderSettings(next);
    await this.refresh([], [], ''); // 设置变更不依赖盘点状态，传空即可
  }

  /** 核心：根据盘点完成度与设置生成计划，并与原生端 diff */
  async refresh(
    assets: readonly Asset[],
    snapshots: readonly AssetSnapshot[],
    userId: string,
  ): Promise<void> {
    if (!this._backend) return;

    // 1. 设置
    await this.init();
    const s = this.settings!;
    if (!s.enabled) {
      await this._clearAll();
      return;
    }

    // 2. 盘点完成度（空资产时仍生成计划——首月引导场景）
    const inventory = getInventoryStatus(assets, snapshots, userId);

    // 3. 生成计划
    const from = new Date();
    const plan = buildReminderPlan(s, from, PLAN_MONTHS_AHEAD);

    // 4. 过滤已完成的月份（不用提醒）
    const desired = plan.filter((p) => {
      // 相同月份：inventory 是当前 ref 月，不一定匹配提醒追踪的月；
      // 只有追踪月与当前 ref 月相同时才按完成度过滤
      if (p.month === inventory.month && inventory.complete) return false;
      return true;
    });
    this.desired = desired;

    // 5. 判断权限（Android 13+ 需要 POST_NOTIFICATIONS）
    const permitted = await this._backend.requestPermission();
    if (!permitted) return; // 等用户下次触发或手动打开设置

    // 6. 启动时 diff 校验（鸿蒙端：用户可能在日历 App 中手动删除了事件）
    if (this._backend.getScheduledIds) {
      const nativeIds = await this._backend.getScheduledIds();
      const nativeSet = new Set(nativeIds);
      // 找出被用户手动删除的事件（在 JS 端 scheduled 但不在原生端 nativeIds）
      const toRestore: string[] = [];
      for (const id of this.scheduled) {
        if (!nativeSet.has(id)) toRestore.push(id);
      }
      // 重建被删除的事件
      if (toRestore.length > 0) {
        console.log(`[reminder-service] restoring ${toRestore.length} deleted events`);
        for (const id of toRestore) {
          const plan = desired.find((p) => p.id === id);
          if (plan) {
            const ok = await this._backend.schedule(
              plan.id,
              plan.fireAt,
              NOTIFICATION_TITLE,
              NOTIFICATION_BODY,
            );
            if (!ok) this.scheduled.delete(id);
          }
        }
      }
    }

    // 7. Diff 调度
    const desiredIds = new Set(desired.map((d) => d.id));
    const toCancel: string[] = [];
    for (const id of this.scheduled) {
      if (!desiredIds.has(id)) toCancel.push(id);
    }
    const toSchedule = desired.filter((d) => !this.scheduled.has(d.id));

    // 7. 执行
    for (const id of toCancel) {
      await this._backend.cancel(id);
      this.scheduled.delete(id);
    }
    for (const r of toSchedule) {
      const ok = await this._backend.schedule(r.id, r.fireAt, NOTIFICATION_TITLE, NOTIFICATION_BODY);
      if (ok) this.scheduled.add(r.id);
    }
  }

  /** 登出时取消全部 */
  async onLogout(): Promise<void> {
    await this._clearAll();
    this.settings = null;
  }

  /** App 回到前台时刷新（时间/时区/完成度可能已变） */
  async onAppForeground(
    assets: readonly Asset[],
    snapshots: readonly AssetSnapshot[],
    userId: string,
  ): Promise<void> {
    await this.refresh(assets, snapshots, userId);
  }

  /** 快照增删改后刷新 */
  async onSnapshotChanged(
    assets: readonly Asset[],
    snapshots: readonly AssetSnapshot[],
    userId: string,
  ): Promise<void> {
    await this.refresh(assets, snapshots, userId);
  }

  /** 同步 pull 完成后刷新 */
  async onSyncCompleted(
    assets: readonly Asset[],
    snapshots: readonly AssetSnapshot[],
    userId: string,
  ): Promise<void> {
    await this.refresh(assets, snapshots, userId);
  }

  // ---------- 内部 ----------

  private async _clearAll(): Promise<void> {
    if (!this._backend) return;
    await this._backend.cancelAll();
    this.scheduled.clear();
    this.desired = [];
  }
}

// 全局单例（默认无 backend，由 App.tsx 在启动时按平台注入）
export const reminderService = new ReminderService();
