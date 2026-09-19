/**
 * 认证状态 Store (Zustand)
 *
 * 内存中保存：当前用户、会话状态、UMK（仅登录期间）、登录/注册 loading/error
 * UMK 派生见 services/key-store.ts（避免循环依赖）
 */

import { create } from 'zustand';
import type { Session, User } from '@family-wealth/api';
import { getAuthClient } from '@family-wealth/api';
import { deriveUMK, fromBase64 } from '@family-wealth/crypto';
import { saveSalt, saveSession, clearAll } from '../services/secure-storage';
import { useKeyStore } from './key-store';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'error';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  error: string | null;

  // Actions
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // 初始为 loading：hydrate 完成前 AuthGuard 不得做任何跳转
  // （之前初始值是 idle，hydrate 结束后仍是 idle 不触发状态变化，
  //  effect 不再执行，未登录用户会卡在首页）
  status: 'loading',
  user: null,
  session: null,
  error: null,

  async signIn(email, password) {
    set({ status: 'loading', error: null });
    const result = await getAuthClient().signIn({ email, password });
    if (!result.ok) {
      set({ status: 'error', error: result.error?.message ?? '登录失败' });
      return false;
    }
    set({
      status: 'authenticated',
      user: result.data!.user,
      session: result.data!.session,
      error: null,
    });
    // 持久化 salt 与 token，供重启后离线解锁
    await saveSalt(result.data!.user.salt);
    await saveSession({
      accessToken: result.data!.session.accessToken,
      refreshToken: result.data!.session.refreshToken,
    });
    // 用密码 + salt 派生存入内存的 UMK（建家庭/加解密资产的根密钥）
    useKeyStore.getState().setUmk(deriveUMK(password, fromBase64(result.data!.user.salt)));
    return true;
  },

  async signUp(email, password, displayName) {
    set({ status: 'loading', error: null });
    try {
      const result = await getAuthClient().signUp({ email, password, displayName });
      if (!result.ok) {
        set({ status: 'error', error: result.error?.message ?? '注册失败' });
        return false;
      }
      set({
        status: 'authenticated',
        user: result.data!.user,
        session: result.data!.session,
        error: null,
      });
      await saveSalt(result.data!.user.salt);
      await saveSession({
        accessToken: result.data!.session.accessToken,
        refreshToken: result.data!.session.refreshToken,
      });
      // 注册成功即已登录：派生 UMK（建家庭/加解密资产的根密钥）
      const umk = deriveUMK(password, fromBase64(result.data!.user.salt));
      useKeyStore.getState().setUmk(umk);
      return true;
    } catch (err) {
      // Keychain/PBKDF2 异常不能让按钮永远停在 loading
      set({ status: 'error', error: (err as Error)?.message ?? '注册失败' });
      return false;
    }
  },

  async signOut() {
    await getAuthClient().signOut();
    await clearAll();
    useKeyStore.getState().clear();
    set({ status: 'idle', user: null, session: null, error: null });
  },

  async hydrate() {
    try {
      const session = await getAuthClient().getSession();
      const user = await getAuthClient().getCurrentUser();
      if (session && user) {
        set({ status: 'authenticated', user, session });
      } else {
        set({ status: 'idle', user: null, session: null });
      }
    } catch (err) {
      // 存储/网络异常时不能卡在 loading，否则 AuthGuard 永远不跳转
      console.warn('[auth] hydrate failed:', (err as Error).message);
      set({ status: 'idle', user: null, session: null });
    }
  },
}));

/** 派生 selector：当前是否已登录 */
export const useIsAuthenticated = (): boolean => useAuthStore((s) => s.status === 'authenticated');