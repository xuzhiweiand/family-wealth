/**
 * 认证状态 Store (Zustand)
 *
 * 内存中保存：当前用户、会话状态、UMK（仅登录期间）、登录/注册 loading/error
 * UMK 派生见 services/key-store.ts（避免循环依赖）
 *
 * 0.1.5：UMK + user + session 全部持久化到 Keychain，重启后 hydrate
 * 全本地读取 + supabase.auth.setSession() 恢复 SDK 态，无需网络、无需重输密码。
 */

import { create } from 'zustand';
import type { Session, User } from '@family-wealth/api';
import { getAuthClient } from '@family-wealth/api';
import { deriveUMK, fromBase64, toBase64 } from '@family-wealth/crypto';
import {
  saveSalt, saveSession, saveUmk, saveUser,
  getSessionTokens, getUmk, getUser,
  clearAll,
} from '../services/secure-storage';
import { supabase } from '../services/supabase';
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
    const user = result.data!.user;
    const session = result.data!.session;
    const umk = deriveUMK(password, fromBase64(user.salt));

    set({ status: 'authenticated', user, session, error: null });

    // 持久化全部凭据到 Keychain（fire-and-forget，不阻塞 UI）
    const umkBase64 = toBase64(umk);
    void saveSalt(user.salt);
    void saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    void saveUmk(umkBase64);
    void saveUser(JSON.stringify(user));

    useKeyStore.getState().setUmk(umk);
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
      const user = result.data!.user;
      const session = result.data!.session;
      const umk = deriveUMK(password, fromBase64(user.salt));

      set({ status: 'authenticated', user, session, error: null });

      const umkBase64 = toBase64(umk);
      void saveSalt(user.salt);
      void saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken });
      void saveUmk(umkBase64);
      void saveUser(JSON.stringify(user));

      useKeyStore.getState().setUmk(umk);
      return true;
    } catch (err) {
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
      // 全本地读取：Keychain 里的 session + UMK + user
      const [tokens, umkBase64, userJson] = await Promise.all([
        getSessionTokens(),
        getUmk(),
        getUser(),
      ]);

      if (tokens && umkBase64 && userJson) {
        // 恢复 Supabase SDK 内部 session（后续 API 调用需要 Authorization header）
        if (supabase) {
          const { error } = await supabase.auth.setSession({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
          });
          if (error) {
            // token 过期或无效 → 落回登录
            console.warn('[auth] setSession failed:', error.message);
            set({ status: 'idle', user: null, session: null });
            return;
          }
        }

        const user = JSON.parse(userJson) as User;
        const session: Session = {
          userId: user.id,
          email: user.email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: 0,
        };
        const umk = fromBase64(umkBase64);

        set({ status: 'authenticated', user, session });
        useKeyStore.getState().setUmk(umk);
        return;
      }

      // 无持久化凭据 → 登录页
      set({ status: 'idle', user: null, session: null });
    } catch (err) {
      console.warn('[auth] hydrate failed:', (err as Error).message);
      set({ status: 'idle', user: null, session: null });
    }
  },
}));

/** 派生 selector：当前是否已登录 */
export const useIsAuthenticated = (): boolean => useAuthStore((s) => s.status === 'authenticated');
