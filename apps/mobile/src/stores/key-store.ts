/**
 * 密钥运行时存储
 *
 * UMK 派生后存内存，应用退到后台 5 分钟后清空（由 useAutoLock hook 驱动）
 * 不持久化 UMK，只持久化服务端 salt（用于重派生）
 *
 * ⚠️ W2 占位：仅做内存 Map + 锁定逻辑
 * W3 接入 react-native-keychain 做服务端 salt 的安全持久化
 */

import { create } from 'zustand';

interface KeyState {
  umk: Uint8Array | null;
  familyId: string | null;
  /** 最后活跃时间戳（用于自动锁定） */
  lastActiveAt: number;

  setUmk: (umk: Uint8Array | null, familyId?: string | null) => void;
  markActive: () => void;
  clear: () => void;
}

export const useKeyStore = create<KeyState>((set) => ({
  umk: null,
  familyId: null,
  lastActiveAt: Date.now(),

  setUmk(umk, familyId = null) {
    set({ umk, familyId, lastActiveAt: Date.now() });
  },

  markActive() {
    set({ lastActiveAt: Date.now() });
  },

  clear() {
    set({ umk: null, familyId: null, lastActiveAt: Date.now() });
  },
}));

/** 5 分钟空闲则锁定 */
export const AUTO_LOCK_MS = 5 * 60 * 1000;

export function isLockDue(lastActiveAt: number, now: number = Date.now()): boolean {
  return now - lastActiveAt >= AUTO_LOCK_MS;
}