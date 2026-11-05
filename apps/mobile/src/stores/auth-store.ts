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
import type { HuaweiAccount, Session, User } from '@family-wealth/api';
import { getAuthClient } from '@family-wealth/api';
import {
  createPasswordCheckEnvelopeWithUMK,
  deriveUMKFast,
  fromBase64,
  generateSalt,
  toBase64,
  verifyEnvelopeWithUMK,
} from '@family-wealth/crypto';
import {
  saveSalt, saveSession, saveUmk, saveUser,
  getSessionTokens, getSalt, getUmk, getUser,
  clearAll, clearSession, clearUser, clearPhone, clearSalt, clearUmk,
} from '../services/secure-storage';
import {
  isHuaweiAccountAvailable,
  requestHuaweiAuthorization,
} from '../services/huawei-auth';
import { supabase } from '../services/supabase';
import { useKeyStore } from './key-store';
import { useFamilyStore } from './family-store';
import { useAssetStore } from './asset-store';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'error' | 'pending-huawei';

interface PendingHuawei {
  account: HuaweiAccount;
  session: Session;
}

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  error: string | null;
  /** 华为授权已完成、等待设置/输入加密密码的过渡态 */
  pendingHuawei: PendingHuawei | null;

  // Actions
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signInWithHuawei: (authorizationCode: string, state: string) => Promise<boolean>;
  completeHuaweiLogin: (password: string) => Promise<boolean>;
  /** 华为首次登录时选择「绑定已有邮箱账号」：邮箱密码校验 + openID 关联 */
  bindHuaweiToEmail: (email: string, password: string) => Promise<boolean>;
  cancelHuaweiLogin: () => Promise<void>;
  signOut: () => Promise<void>;
  /** 注销账号：删除服务端账号并清空本地数据，回到登录页 */
  deleteAccount: () => Promise<boolean>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  /**
   * 尝试复用本机缓存的 UMK（华为账号再次登录时免输加密主密码）
   *
   * 安全前提：本地 salt 必须与服务端档案一致，且 UMK 能通过密码信封校验，
   * 因此只有「同一台设备 + 同一份加密档案」才会命中，换机或档案变更仍要求输入密码。
   */
  const restoreLocalUmk = async (
    serverSalt: string,
    envelope: string,
  ): Promise<Uint8Array | null> => {
    try {
      const [localSalt, umkBase64] = await Promise.all([getSalt(), getUmk()]);
      if (!localSalt || !umkBase64 || localSalt !== serverSalt) return null;
      const umk = fromBase64(umkBase64);
      return verifyEnvelopeWithUMK(umk, envelope) ? umk : null;
    } catch {
      return null;
    }
  };

  /** 华为链路统一收尾：落盘 + UMK 入钥匙串 + 后台拉数据 */
  const finalizeHuaweiLogin = (user: User, session: Session, umk: Uint8Array): void => {
    set({ status: 'authenticated', user, session, pendingHuawei: null, error: null });
    void saveSalt(user.salt);
    void saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    void saveUser(JSON.stringify(user));
    useKeyStore.getState().setUmk(umk);
    void saveUmk(toBase64(umk));

    void (async () => {
      await useFamilyStore.getState().refresh();
      const familyId = useKeyStore.getState().familyId;
      if (familyId) await useAssetStore.getState().load(familyId);
    })();
  };

  return {
  // 初始为 loading：hydrate 完成前 AuthGuard 不得做任何跳转
  status: 'loading',
  user: null,
  session: null,
  error: null,
  pendingHuawei: null,

  async signIn(email, password) {
    set({ status: 'loading', error: null });
    try {
      // 第一阶段：鉴权 + 档案解析（纯网络等待，无 CPU 重活）
      const result = await getAuthClient().signIn({ email, password });
      if (!result.ok) {
        set({ status: 'error', error: result.error?.message ?? '登录失败' });
        return false;
      }
      const user = result.data!.user;
      const session = result.data!.session;

      // 第二阶段：立即建立登录态，让主页先挂载、首帧先渲染。
      // salt/session/user 先持久化（UMK 稍后派生后补存）。
      set({ status: 'authenticated', user, session, error: null });
      void saveSalt(user.salt);
      void saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken });
      void saveUser(JSON.stringify(user));

      // 等待主页完成首帧绘制（两帧：挂载帧 + 绘制帧）
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      // 第三阶段：派生 UMK（鸿蒙走原生 cryptoFramework，异步、不冻结
      // JS 线程；其他平台回落纯 JS），并校验密码信封。
      // GoTrue 已验证密码；信封复检用于保留 salt 篡改检测，失败即回登出态。
      const umk = await deriveUMKFast(password, fromBase64(user.salt));
      if (!verifyEnvelopeWithUMK(umk, user.passwordCheckEnvelope)) {
        useKeyStore.getState().clear();
        await getAuthClient().signOut();
        await clearAll();
        set({ status: 'idle', user: null, session: null, error: '安全校验未通过，请重新登录' });
        return false;
      }
      useKeyStore.getState().setUmk(umk);
      void saveUmk(toBase64(umk));

      // 第四阶段：UMK 就绪 → 恢复家庭与 FDK → 拉取资产数据（均在后台）
      void (async () => {
        await useFamilyStore.getState().refresh();
        const familyId = useKeyStore.getState().familyId;
        if (familyId) await useAssetStore.getState().load(familyId);
      })();

      return true;
    } catch (err) {
      set({ status: 'error', error: (err as Error)?.message ?? '登录失败' });
      return false;
    }
  },

  async signInWithHuawei(authorizationCode, state) {
    set({ status: 'loading', error: null, pendingHuawei: null });
    try {
      const result = await getAuthClient().signInWithHuawei({ authorizationCode, state });
      if (!result.ok || !result.data) {
        set({ status: 'error', error: result.error?.message ?? '华为账号登录失败' });
        return false;
      }
      const { account, session } = result.data;

      // 老用户 + 本机已缓存同一份加密档案的 UMK → 直接解锁，不再要求输入密码。
      // 判定条件：本地 salt 与服务端一致，且 UMK 能通过密码信封校验（防档案被替换）。
      if (account.profile) {
        const umk = await restoreLocalUmk(account.profile.salt, account.profile.passwordCheckEnvelope);
        if (umk) {
          finalizeHuaweiLogin(
            {
              id: account.userId,
              email: account.email,
              displayName: account.displayName,
              salt: account.profile.salt,
              passwordCheckEnvelope: account.profile.passwordCheckEnvelope,
            },
            session,
            umk,
          );
          return true;
        }
      }

      // 首次登录本设备（或换机/档案变更）：仍需设置或输入加密主密码
      set({
        status: 'pending-huawei',
        pendingHuawei: result.data,
        user: null,
        session,
        error: null,
      });
      return true;
    } catch (err) {
      set({ status: 'error', error: (err as Error)?.message ?? '华为账号登录失败' });
      return false;
    }
  },

  async completeHuaweiLogin(password) {
    const pending = get().pendingHuawei;
    if (!pending) return false;
    if (password.length < 8) {
      set({ error: '密码至少 8 位' });
      return false;
    }

    set({ error: null });
    try {
      const { account, session } = pending;
      let user: User;
      let umk: Uint8Array;

      if (account.profile) {
        // 老用户：用服务端 salt 派生 UMK，并校验密码信封
        umk = await deriveUMKFast(password, fromBase64(account.profile.salt));
        if (!verifyEnvelopeWithUMK(umk, account.profile.passwordCheckEnvelope)) {
          set({ error: '密码不正确，请重试' });
          return false;
        }
        user = {
          id: account.userId,
          email: account.email,
          displayName: account.displayName,
          salt: account.profile.salt,
          passwordCheckEnvelope: account.profile.passwordCheckEnvelope,
        };
      } else {
        // 首次登录：生成 salt → 派生 UMK → 用 UMK 生成密码信封并写入服务端
        const salt = generateSalt();
        umk = await deriveUMKFast(password, salt);
        const envelope = createPasswordCheckEnvelopeWithUMK(umk);
        const saved = await getAuthClient().saveEncryptionProfile({
          userId: account.userId,
          email: account.email,
          displayName: account.displayName,
          salt: toBase64(salt),
          passwordCheckEnvelope: envelope,
        });
        if (!saved.ok || !saved.data) {
          set({ error: saved.error?.message ?? '加密档案保存失败' });
          return false;
        }
        user = saved.data;
      }

      finalizeHuaweiLogin(user, session, umk);

      return true;
    } catch (err) {
      set({ error: (err as Error)?.message ?? '加密密码设置失败' });
      return false;
    }
  },

  async bindHuaweiToEmail(email, password) {
    if (!get().pendingHuawei) return false;
    set({ error: null });
    try {
      // 登录时的授权码已被一次性消费，绑定前重新授权取新 code
      // （刚授权过，Account Kit 会快速返回，通常只需再点一次确认）
      const auth = await requestHuaweiAuthorization();
      if (!auth.ok) {
        if (auth.reason !== 'cancelled') set({ error: auth.message });
        return false;
      }

      const result = await getAuthClient().bindHuaweiToEmailAccount({
        ...auth.data,
        email,
        password,
      });
      if (!result.ok || !result.data) {
        set({ error: result.error?.message ?? '绑定失败，请重试' });
        return false;
      }

      const { account, session } = result.data;
      if (!account.profile) {
        set({ error: '该邮箱账号缺少加密档案，无法绑定' });
        return false;
      }
      const umk = await deriveUMKFast(password, fromBase64(account.profile.salt));
      if (!verifyEnvelopeWithUMK(umk, account.profile.passwordCheckEnvelope)) {
        set({ error: '密码不正确，请重试' });
        return false;
      }

      const user: User = {
        id: account.userId,
        email: account.email,
        displayName: account.displayName,
        salt: account.profile.salt,
        passwordCheckEnvelope: account.profile.passwordCheckEnvelope,
      };
      finalizeHuaweiLogin(user, session, umk);
      return true;
    } catch (err) {
      set({ error: (err as Error)?.message ?? '绑定失败，请重试' });
      return false;
    }
  },

  async cancelHuaweiLogin() {
    await getAuthClient().signOut();
    set({ status: 'idle', pendingHuawei: null, user: null, session: null, error: null });
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
      // 优先用 SupabaseAuthClient 缓存的 UMK（避免重复 PBKDF2）
      const client = getAuthClient();
      const cachedUMK = 'consumeDerivedUMK' in client
        ? (client as { consumeDerivedUMK(): Uint8Array | null }).consumeDerivedUMK()
        : null;
      const umk = cachedUMK ?? await deriveUMKFast(password, fromBase64(user.salt));

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
    // 仅清理会话相关凭据；保留 salt + UMK，使同一设备再次用华为账号登录时免输加密主密码
    await Promise.all([clearSession(), clearUser(), clearPhone()]);
    useKeyStore.getState().clear();
    // 清空家庭上下文并复位首刷标记：下个账号登录时首页重新走骨架，
    // 不会凭 refreshed=true 直接渲染上一账号的家庭数据
    useFamilyStore.setState({
      family: null,
      members: [],
      invites: [],
      activeInvite: null,
      rotationPending: false,
      refreshed: false,
    });
    set({ status: 'idle', user: null, session: null, pendingHuawei: null, error: null });
  },

  async deleteAccount() {
    set({ error: null });
    try {
      const result = await getAuthClient().deleteAccount();
      if (!result.ok) {
        set({ error: result.error?.message ?? '注销失败，请重试' });
        return false;
      }
      // 服务端账号已删除，复用退出登录的本地清理
      await get().signOut();
      // 账号已不存在，加密档案随之失效，彻底清除 salt 与 UMK
      await Promise.all([clearSalt(), clearUmk()]);
      return true;
    } catch (err) {
      set({ error: (err as Error)?.message ?? '注销失败，请重试' });
      return false;
    }
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
      set({ status: 'idle', user: null, session: null, pendingHuawei: null });
    } catch (err) {
      console.warn('[auth] hydrate failed:', (err as Error).message);
      set({ status: 'idle', user: null, session: null, pendingHuawei: null });
    }
  },
  };
});

/** 派生 selector：当前是否已登录 */
export const useIsAuthenticated = (): boolean => useAuthStore((s) => s.status === 'authenticated');
