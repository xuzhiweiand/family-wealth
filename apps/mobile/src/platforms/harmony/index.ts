/**
 * 鸿蒙平台适配层
 *
 * RNOH（react-native-harmony）缺少 react-native-keychain 等库的原生实现，
 * 此文件提供同契约的 JS 实现/空实现。metro.config.js 在 harmony 平台把
 * 对应模块名重定向到本文件（目录 index.ts）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============ react-native-keychain ============
// 鸿蒙侧暂无 keychain 端口，以应用沙箱内 AsyncStorage 承载
// （与 Android 应用私有目录同级保护），保持调用契约一致，
// 使登录态持久化 / 自动登录链路可用。
interface StoredCredential {
  username: string;
  password: string;
}

const DEFAULT_SERVICE = 'family-wealth.default';

async function setGenericPassword(
  username: string,
  password: string,
  opts?: { service?: string },
): Promise<true> {
  const key = opts?.service ?? DEFAULT_SERVICE;
  const value: StoredCredential = { username, password };
  await AsyncStorage.setItem(key, JSON.stringify(value));
  return true;
}

async function getGenericPassword(opts?: {
  service?: string;
}): Promise<false | (StoredCredential & { service: string })> {
  const key = opts?.service ?? DEFAULT_SERVICE;
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return false;
  try {
    const parsed = JSON.parse(raw) as StoredCredential;
    return { service: key, username: parsed.username, password: parsed.password };
  } catch {
    return false;
  }
}

async function resetGenericPassword(opts?: { service?: string }): Promise<true> {
  const key = opts?.service ?? DEFAULT_SERVICE;
  await AsyncStorage.removeItem(key);
  return true;
}

async function setInternetCredentials(
  server: string,
  username: string,
  password: string,
): Promise<true> {
  return setGenericPassword(username, password, { service: server });
}

async function getInternetCredentials(
  server: string,
): Promise<false | (StoredCredential & { server: string })> {
  const result = await getGenericPassword({ service: server });
  if (result === false) return false;
  return { server, username: result.username, password: result.password };
}

async function resetInternetCredentials(server: string): Promise<true> {
  return resetGenericPassword({ service: server });
}

// ============ @react-native-ml-kit/text-recognition ============
// 鸿蒙侧可用鸿蒙 AI OCR 替代；暂为空实现，不阻断其他功能
export const MLKitTextRecognition = {
  recognize: async (_imagePath: string) => {
    console.warn(
      '[HarmonyOS] MLKit text recognition not implemented, use HarmonyOS AI OCR instead',
    );
    return { text: '', blocks: [] };
  },
};

// ============ Platform 判断 ============
import { Platform } from 'react-native';

export const isHarmony = (Platform.OS as string) === 'harmony';
export const isAndroid = Platform.OS === 'android';
export const isIOS = Platform.OS === 'ios';

// 鸿蒙平台特定配置
export const HarmonyConfig = {
  useNativeOCR: true,
  useNativeKeychain: true,
  version: '0.1.6',
};

export {
  setGenericPassword,
  getGenericPassword,
  resetGenericPassword,
  setInternetCredentials,
  getInternetCredentials,
  resetInternetCredentials,
};

export default {
  setGenericPassword,
  getGenericPassword,
  resetGenericPassword,
  setInternetCredentials,
  getInternetCredentials,
  resetInternetCredentials,
  MLKitTextRecognition,
  isHarmony,
  isAndroid,
  isIOS,
  HarmonyConfig,
};
