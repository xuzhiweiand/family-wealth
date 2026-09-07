/**
 * 认证状态 Store (Zustand)
 *
 * 内存中保存：当前用户、会话状态、UMK（仅登录期间）、登录/注册 loading/error
 * UMK 派生见 services/key-store.ts（避免循环依赖）
 */

import { create } from 'zustand';
import type { Session, User } from '@family-wealth/api';
import { getAuthClient } from '@family-wealth/api';

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
  status: 'idle',
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
    return true;
  },

  async signUp(email, password, displayName) {
    set({ status: 'loading', error: null });
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
    return true;
  },

  async signOut() {
    await getAuthClient().signOut();
    set({ status: 'idle', user: null, session: null, error: null });
  },

  async hydrate() {
    const session = await getAuthClient().getSession();
    const user = await getAuthClient().getCurrentUser();
    if (session && user) {
      set({ status: 'authenticated', user, session });
    } else {
      set({ status: 'idle', user: null, session: null });
    }
  },
}));

/** 派生 selector：当前是否已登录 */
export const useIsAuthenticated = (): boolean => useAuthStore((s) => s.status === 'authenticated');