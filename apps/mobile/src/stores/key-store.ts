/**
 * 密钥运行时存储
 *
 * UMK 派生后存内存，应用退到后台 5 分钟后清空（由 useAutoLock hook 驱动）
 * 不持久化 UMK，只持久化服务端 salt（用于重派生）。
 *
 * salt / session 的持久化由 services/secure-storage.ts（react-native-keychain）承担，
 * 已在 auth-store 的 signIn / signUp / signOut 接入；本 store 只管内存态 UMK。
 * keychain 是 native 模块，本机沙箱装不上，需真机 prebuild 后验证（见 MEMORY pitfall #6）。
 */

import { create } from 'zustand';

interface KeyState {
  umk: Uint8Array | null;
  /** 家庭数据密钥（解出后存内存；建家庭/加入/领取轮换时设置） */
  fdk: Uint8Array | null;
  familyId: string | null;
  /** 最后活跃时间戳（用于自动锁定） */
  lastActiveAt: number;

  setUmk: (umk: Uint8Array | null, familyId?: string | null) => void;
  setFdk: (fdk: Uint8Array | null) => void;
  /** 只切换当前家庭上下文，不动 UMK（登录后恢复家庭用） */
  setFamilyId: (familyId: string | null) => void;
  markActive: () => void;
  clear: () => void;
}

export const useKeyStore = create<KeyState>((set) => ({
  umk: null,
  fdk: null,
  familyId: null,
  lastActiveAt: Date.now(),

  setUmk(umk, familyId = null) {
    set({ umk, familyId, lastActiveAt: Date.now() });
  },

  setFdk(fdk) {
    set({ fdk });
  },

  setFamilyId(familyId) {
    set({ familyId });
  },

  markActive() {
    set({ lastActiveAt: Date.now() });
  },

  clear() {
    set({ umk: null, fdk: null, familyId: null, lastActiveAt: Date.now() });
  },
}));

/** 5 分钟空闲则锁定 */
export const AUTO_LOCK_MS = 5 * 60 * 1000;

export function isLockDue(lastActiveAt: number, now: number = Date.now()): boolean {
  return now - lastActiveAt >= AUTO_LOCK_MS;
}