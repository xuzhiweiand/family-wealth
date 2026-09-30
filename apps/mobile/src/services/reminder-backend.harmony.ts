/**
 * 鸿蒙盘点提醒后端（ReminderAgent TurboModule + Calendar Kit 实现）
 *
 * - 调用 calendarManager 创建系统日历事件（READ/WRITE_CALENDAR，user_grant）
 * - 无需 AGC ACL 审批，弹窗授权即可使用
 * - 支持按月重复事件（recurrenceRule），简化调度逻辑
 */

import type { ReminderBackend } from './reminder-service';

interface ReminderAgentModule {
  publishCalendarReminder(
    id: string,
    timestamp: number,
    title: string,
    body: string,
    recurring: boolean,
  ): Promise<boolean>;
  cancelReminder(id: string): Promise<void>;
  cancelAllReminders(): Promise<void>;
  requestCalendarPermission(): Promise<boolean>;
  checkCalendarPermission(): Promise<string>;
  getScheduledReminders(): Promise<string>; // JSON string[]
}

let module: ReminderAgentModule | null | undefined;

function getModule(): ReminderAgentModule | null {
  if (module === undefined) {
    try {
      // 绕过 TS 类型：Platform.OS 不包含 'harmony'（与 packages/crypto/src/kdf.ts 同款处理）
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const rn = require('react-native');
      if (rn.Platform.OS === 'harmony') {
        module = rn.TurboModuleRegistry.getEnforcing('ReminderAgent') as ReminderAgentModule;
      } else {
        module = null;
      }
    } catch {
      module = null;
    }
  }
  return module ?? null;
}

export const reminderBackend: ReminderBackend = {
  async requestPermission(): Promise<boolean> {
    const m = getModule();
    if (!m) return false;
    try {
      return await m.requestCalendarPermission();
    } catch {
      return false;
    }
  },

  async getPermissionStatus(): Promise<'granted' | 'denied' | 'unknown'> {
    const m = getModule();
    if (!m) return 'unknown';
    try {
      const status = await m.checkCalendarPermission();
      if (status === 'granted') return 'granted';
      if (status === 'denied') return 'denied';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  },

  async openSystemSettings(): Promise<void> {
    // 鸿蒙暂不支持直接跳转日历权限设置页
    // TODO: 通过 wantAgent 拉起系统设置 Ability
  },

  async getScheduledIds(): Promise<string[]> {
    const m = getModule();
    if (!m) return [];
    try {
      const json = await m.getScheduledReminders();
      return JSON.parse(json) as string[];
    } catch {
      return [];
    }
  },

  async schedule(id: string, fireAt: Date, title: string, body: string): Promise<boolean> {
    const m = getModule();
    if (!m) return false;
    try {
      // 主提醒按月重复，重试提醒单次
      const isRecurring = id.includes(':main:');
      return await m.publishCalendarReminder(id, fireAt.getTime(), title, body, isRecurring);
    } catch (err) {
      console.warn('[reminder-backend.harmony] schedule failed:', err);
      return false;
    }
  },

  async cancel(id: string): Promise<void> {
    const m = getModule();
    if (!m) return;
    try {
      await m.cancelReminder(id);
    } catch (err) {
      console.warn('[reminder-backend.harmony] cancel failed:', err);
    }
  },

  async cancelAll(): Promise<void> {
    const m = getModule();
    if (!m) return;
    try {
      await m.cancelAllReminders();
    } catch (err) {
      console.warn('[reminder-backend.harmony] cancelAll failed:', err);
    }
  },
};

/**
 * 鸿蒙端通知点击处理（TODO：日历事件支持关联 app 图标，点击打开系统日历）。
 * 当前版本点击通知后打开日历 App，用户在日历中查看提醒。
 */
export function initReminderNotifications(): () => void {
  return () => {};
}
