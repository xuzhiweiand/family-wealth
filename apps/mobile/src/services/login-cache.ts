/**
 * 登录档案本地缓存（0.1.7 登录性能优化）
 *
 * 用途：把「非机密但登录必须」的 profile 字段缓存在本机：
 *  - salt（base64）：登录开始即可与网络请求并行启动 PBKDF2
 *  - password_check_envelope：命中缓存时省去 profiles 查询这一个串行 RTT
 *  - displayName：缓存命中时直接回填用户信息
 *
 * 安全说明：salt 本就标注「非机密」；envelope 是公开校验体，
 * 其安全性依赖 PBKDF2 100k 的离线猜测成本，本机副本不削弱该属性。
 * 存储用 AsyncStorage（应用私有沙箱；鸿蒙侧 keychain 适配层同为沙箱存储）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSalt } from './secure-storage';

const STORAGE_KEY = 'family-wealth.login-cache.v1';

export interface CachedLoginProfile {
  salt: string;
  envelope: string | null;
  displayName: string | null;
}

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function readMap(): Promise<Record<string, CachedLoginProfile>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { v?: number; profiles?: Record<string, CachedLoginProfile> };
    if (parsed.v !== 1 || !parsed.profiles) return {};
    return parsed.profiles;
  } catch {
    return {};
  }
}

export async function getCachedLogin(email: string): Promise<CachedLoginProfile | null> {
  const profiles = await readMap();
  const hit = profiles[normEmail(email)];
  if (hit) return hit;

  // 兼容旧版本：salt 单独存在 keychain（本机最近登录用户），
  // envelope 仍需联网拉取，但 PBKDF2 已可与鉴权请求并行。
  const legacySalt = await getSalt();
  if (legacySalt) return { salt: legacySalt, envelope: null, displayName: null };
  return null;
}

export async function saveCachedLogin(
  email: string,
  profile: CachedLoginProfile,
): Promise<void> {
  const profiles = await readMap();
  profiles[normEmail(email)] = profile;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, profiles }));
}
