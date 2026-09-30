/**
 * Android 盘点提醒后端（notifee 实现，默认平台文件）。
 *
 * - 本地定时通知，不依赖 FCM；
 * - 通道 inventory_reminder（盘点提醒）；
 * - AlarmManager 精确触发（用户未授权精确闹钟时系统回落 inexact）；
 * - 点击事件（前台/后台/冷启动）统一入 notification-action 队列。
 *
 * 鸿蒙端由 reminder-backend.harmony.ts 提供同名导出（T6 自研 TurboModule）。
 */

import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  EventType,
  TriggerType,
} from '@notifee/react-native';
import type { ReminderBackend } from './reminder-service';
import { queueOpenAssetNew } from '../lib/notification-action';

const CHANNEL_ID = 'inventory_reminder';

async function ensureChannel(): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: '盘点提醒',
    importance: AndroidImportance.HIGH,
  });
}

export const reminderBackend: ReminderBackend = {
  async requestPermission(): Promise<boolean> {
    const settings = await notifee.requestPermission();
    return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
  },

  async getPermissionStatus(): Promise<'granted' | 'denied' | 'unknown'> {
    const settings = await notifee.getNotificationSettings();
    if (settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED) return 'granted';
    if (settings.authorizationStatus === AuthorizationStatus.DENIED) return 'denied';
    return 'unknown';
  },

  async openSystemSettings(): Promise<void> {
    await notifee.openNotificationSettings();
  },

  async schedule(id: string, fireAt: Date, title: string, body: string): Promise<boolean> {
    try {
      await ensureChannel();
      await notifee.createTriggerNotification(
        {
          id,
          title,
          body,
          android: {
            channelId: CHANNEL_ID,
            smallIcon: 'ic_launcher',
            pressAction: { id: 'default' }, // 点击拉起 MainActivity
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: fireAt.getTime(),
          alarmManager: { allowWhileIdle: true },
        },
      );
      return true;
    } catch {
      return false;
    }
  },

  async cancel(id: string): Promise<void> {
    await notifee.cancelNotification(id);
  },

  async cancelAll(): Promise<void> {
    await notifee.cancelAllNotifications();
  },

  async getScheduledIds(): Promise<string[]> {
    const ids = await notifee.getTriggerNotificationIds();
    return ids ?? [];
  },
};

/**
 * App 启动时调用一次：建通道 + 注册点击监听 + 处理冷启动点击。
 */
export function initReminderNotifications(): () => void {
  void ensureChannel();

  // 前台/后台运行时的点击
  const unsubscribe = notifee.onForegroundEvent(({ type }) => {
    if (type === EventType.PRESS) queueOpenAssetNew();
  });

  // 冷启动：由通知拉起
  void notifee.getInitialNotification().then((initial) => {
    if (initial) queueOpenAssetNew();
  });

  return unsubscribe;
}
