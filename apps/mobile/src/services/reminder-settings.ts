/**
 * 盘点提醒设置的本地持久化（AsyncStorage）。
 * 读取时对脏数据做归一化，永远返回合法 ReminderSettings。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_REMINDER_SETTINGS,
  normalizeSettings,
  type ReminderSettings,
} from '../lib/reminder-plan';

const KEY = '@family-wealth/reminder-settings/v1';
const ONBOARDING_KEY = '@family-wealth/reminder-onboarding-shown/v1';

/** 首次引导是否已展示过（无论用户选择开启还是跳过） */
export async function hasShownReminderOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === '1';
  } catch {
    return true; // 读失败视为已展示，避免反复打扰
  }
}

export async function markReminderOnboardingShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* 非关键路径 */
  }
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_REMINDER_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_REMINDER_SETTINGS };
  }
}

export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
