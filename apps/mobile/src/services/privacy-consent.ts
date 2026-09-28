/**
 * 隐私政策同意状态（合规要求：首次启动须明确提示并获得用户同意）
 *
 * 用 AsyncStorage 持久化；未同意前 App 停留在同意弹窗，不同意则退出应用。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'family-wealth.privacy-consent.v1';

/** 隐私政策公网地址（GitHub 托管，随仓库版本管理） */
export const PRIVACY_POLICY_URL =
  'https://github.com/xuzhiweiand/family-wealth/blob/chore/de-expo/docs/privacy-policy.md';

export async function hasConsentedPrivacy(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function savePrivacyConsent(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // 写入失败不阻断流程，下次启动会再次弹窗
  }
}
