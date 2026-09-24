/**
 * 鸿蒙原生模块桥接模板
 *
 * 此文件定义了需要与鸿蒙原生侧桥接的模块接口。
 * 实际桥接代码需要在 DevEco Studio 中用 ArkTS/C++ 实现。
 */

import { NativeModules, Platform } from 'react-native';

// 鸿蒙原生模块名（需要在鸿蒙侧注册同名模块）
const HARMONY_MODULES = {
  // 密钥存储桥接
  KeychainManager: 'KeychainManager',
  // OCR 识别桥接
  OCRManager: 'OCRManager',
  // 图片选择器桥接
  ImagePickerManager: 'ImagePickerManager',
} as const;

// 类型定义
interface HarmonyKeychainModule {
  setGenericPassword(username: string, password: string): Promise<boolean>;
  getGenericPassword(): Promise<{ username: string; password: string } | false>;
  resetGenericPassword(): Promise<boolean>;
}

interface HarmonyOCRModule {
  recognizeText(imageUri: string): Promise<{ text: string; confidence: number }>;
}

interface HarmonyImagePickerModule {
  pickImage(options: { mediaType?: string; quality?: number }): Promise<{ uri: string; width: number; height: number } | null>;
  takePhoto(options: { quality?: number }): Promise<{ uri: string; width: number; height: number } | null>;
}

// 获取原生模块（仅鸿蒙平台有效）
function getHarmonyModule<T>(name: string): T | null {
  if ((Platform.OS as string) !== 'harmony') {
    return null;
  }
  return NativeModules[name] as T || null;
}

// 导出桥接接口
export const HarmonyKeychain = getHarmonyModule<HarmonyKeychainModule>(HARMONY_MODULES.KeychainManager);
export const HarmonyOCR = getHarmonyModule<HarmonyOCRModule>(HARMONY_MODULES.OCRManager);
export const HarmonyImagePicker = getHarmonyModule<HarmonyImagePickerModule>(HARMONY_MODULES.ImagePickerManager);

// 检查模块是否可用
export const isHarmonyKeychainAvailable = () => !!HarmonyKeychain;
export const isHarmonyOCRAvailable = () => !!HarmonyOCR;
export const isHarmonyImagePickerAvailable = () => !!HarmonyImagePicker;

export default {
  HarmonyKeychain,
  HarmonyOCR,
  HarmonyImagePicker,
  isHarmonyKeychainAvailable,
  isHarmonyOCRAvailable,
  isHarmonyImagePickerAvailable,
};
