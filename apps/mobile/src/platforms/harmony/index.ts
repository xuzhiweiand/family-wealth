/**
 * 鸿蒙平台适配层
 *
 * RNOH（react-native-harmony）对部分 Android/iOS 原生模块的支持不完整，
 * 此文件提供鸿蒙侧的替代实现或空实现，确保 JS 代码在鸿蒙上可运行。
 *
 * 使用方式：在 metro.config.js 中配置 resolver，将特定模块重定向到本文件。
 */

// ============ react-native-keychain ============
// 鸿蒙侧使用鸿蒙 KeyStore / Asset Store 替代，此处提供空实现
// 实际实现需要开发鸿蒙原生模块桥接
export const Keychain = {
  setGenericPassword: async (username: string, password: string) => {
    console.warn('[HarmonyOS] Keychain.setGenericPassword not implemented');
    return false;
  },
  getGenericPassword: async () => {
    console.warn('[HarmonyOS] Keychain.getGenericPassword not implemented');
    return false;
  },
  resetGenericPassword: async () => {
    console.warn('[HarmonyOS] Keychain.resetGenericPassword not implemented');
    return false;
  },
  setInternetCredentials: async (server: string, username: string, password: string) => {
    console.warn('[HarmonyOS] Keychain.setInternetCredentials not implemented');
    return false;
  },
  getInternetCredentials: async (server: string) => {
    console.warn('[HarmonyOS] Keychain.getInternetCredentials not implemented');
    return false;
  },
  resetInternetCredentials: async (server: string) => {
    console.warn('[HarmonyOS] Keychain.resetInternetCredentials not implemented');
    return false;
  },
};

// ============ react-native-ml-kit/text-recognition ============
// 鸿蒙侧使用鸿蒙 AI 引擎的 OCR 能力替代
export const MLKitTextRecognition = {
  recognize: async (imagePath: string) => {
    console.warn('[HarmonyOS] MLKit text recognition not implemented, use HarmonyOS AI OCR instead');
    return { text: '', blocks: [] };
  },
};

// ============ react-native-image-picker ============
// 鸿蒙侧使用鸿蒙 PhotoViewPicker / Camera 替代
export const ImagePicker = {
  launchImageLibrary: async (options: any) => {
    console.warn('[HarmonyOS] ImagePicker.launchImageLibrary not implemented');
    return { didCancel: true, assets: [] };
  },
  launchCamera: async (options: any) => {
    console.warn('[HarmonyOS] ImagePicker.launchCamera not implemented');
    return { didCancel: true, assets: [] };
  },
};

// ============ react-native-svg ============
// RNOH 已内置 svg 支持，此处为类型导出占位
export { Svg, Circle, Rect, Path, G, Text as SvgText } from 'react-native-svg';

// ============ react-native-gesture-handler ============
// RNOH 已内置 gesture-handler 支持，直接透传
export * from 'react-native-gesture-handler';

// ============ react-native-safe-area-context ============
// RNOH 已内置 safe-area 支持
export { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// ============ react-native-screens ============
// RNOH 已内置 screens 支持
export { enableScreens } from 'react-native-screens';

// ============ @react-navigation ============
// 导航层 RNOH 已支持，直接透传
export * from '@react-navigation/native';
export * from '@react-navigation/native-stack';
export * from '@react-navigation/bottom-tabs';

// ============ Platform 判断 ============
import { Platform } from 'react-native';

export const isHarmony = (Platform.OS as string) === 'harmony';
export const isAndroid = Platform.OS === 'android';
export const isIOS = Platform.OS === 'ios';

// 鸿蒙平台特定配置
export const HarmonyConfig = {
  // 是否启用鸿蒙原生 OCR（替代 ML Kit）
  useNativeOCR: true,
  // 是否启用鸿蒙原生 Keychain
  useNativeKeychain: true,
  // 鸿蒙应用版本号
  version: '0.1.5',
};

export default {
  Keychain,
  MLKitTextRecognition,
  ImagePicker,
  isHarmony,
  isAndroid,
  isIOS,
  HarmonyConfig,
};
