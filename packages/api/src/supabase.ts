/**
 * SupabaseAuthClient — 基于 @supabase/supabase-js 的真实鉴权实现（W3）
 *
 * 与 InMemoryAuthClient 的差异：
 * - 身份与会话由 Supabase Auth 托管（JWT access token + refresh token）
 * - 服务端 salt + 密码校验信封存于 `profiles` 表（非 Supabase Auth 内置字段）
 * - 登录时用本地 UMK 解密密码校验信封，验证「密码 → UMK」派生正确（E2E 关键）
 *
 * 前提假设（MVP）：
 * - Supabase Auth「Confirm email」关闭（auto-confirm），signUp 即返回 session
 * - 单主密码模型：登录密码 == 加密主密码（同 InMemoryAuthClient，见 ADR-0006）
 */

import { generateSalt, toBase64, fromBase64, createPasswordCheckEnvelope, verifyPasswordCheck } from '@family-wealth/crypto';
import type { AuthClient, AuthResult, Session, SignInInput, SignUpInput, User } from './types';

/**
 * 本模块**不 import @supabase/supabase-js 的类型**，只声明真正用到的那一小摊表面。
 *
 * 原因：supabase-js 各版本导出的类型名与结构差异很大（2.115 起改 .d.cts，
 * 且不再导出 Session / AuthError），直接绑定 SDK 类型一升级就碎。
 * 真正的类型断言只在 bootstrap 里做一次（createClient(...) as unknown as SupabaseLike）。
 */

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number | undefined;
  user: { id: string; email?: string | null };
}

export interface SupabaseUser {
  id: string;
  email?: string | null;
}

/** 错误只需要这三个字段，与 SDK 的 AuthError 结构化兼容 */
export interface AuthErrorLike {
  status?: number | undefined;
  code?: string | undefined;
  message: string;
}

interface AuthResponse {
  data: { user: SupabaseUser | null; session: SupabaseSession | null };
  error: AuthErrorLike | null;
}

export interface SupabaseAuthPort {
  signUp(credentials: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown> };
  }): Promise<AuthResponse>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResponse>;
  signOut(): Promise<{ error: AuthErrorLike | null }>;
  getUser(): Promise<{ data: { user: SupabaseUser | null }; error: AuthErrorLike | null }>;
  getSession(): Promise<{ data: { session: SupabaseSession | null }; error: AuthErrorLike | null }>;
  refreshSession(): Promise<{ data: { session: SupabaseSession | null }; error: AuthErrorLike | null }>;
  onAuthStateChange(listener: (event: string, session: SupabaseSession | null) => void): {
    data: { subscription: { unsubscribe: () => void } };
  };
}

export interface SupabaseLike {
  auth: SupabaseAuthPort;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { single(): Promise<{ data: unknown; error: AuthErrorLike | null }> };
    };
    /** 行对象不要求索引签名，具体表的行类型（如 ProfileRow）可直接传入 */
    upsert(row: object): Promise<{ error: AuthErrorLike | null }>;
  };
}

/** profiles 表一行（salt / password_check_envelope 为 base64 字符串） */
interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  salt: string;
  password_check_envelope: string;
}

export class SupabaseAuthClient implements AuthClient {
  /** 内存缓存 profile，避免每次 getCurrentUser 都查库 */
  private profileCache = new Map<string, ProfileRow>();

  constructor(private readonly supabase: SupabaseLike) {}

  async signUp(input: SignUpInput): Promise<AuthResult<{ user: User; session: Session }>> {
    const { data, error } = await this.supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { display_name: input.displayName } },
    });
    if (error) return this.mapAuthError(error);
    if (!data.user || !data.session) {
      return { ok: false, error: { code: 'UNKNOWN', message: '注册未返回会话（可能开启了邮箱验证）' } };
    }

    // 生成 salt + 密码校验信封，写入 profiles（RLS 限制仅本人可写）
    const salt = generateSalt();
    const envelope = createPasswordCheckEnvelope(input.password, salt);
    const profile: ProfileRow = {
      id: data.user.id,
      email: data.user.email ?? input.email.toLowerCase(),
      display_name: input.displayName,
      salt: toBase64(salt),
      password_check_envelope: envelope,
    };
    const { error: profileErr } = await this.supabase.from('profiles').upsert(profile);
    if (profileErr) {
      // 回滚：profiles 写入失败则登出，避免出现「有账号无档案」的半成品
      await this.supabase.auth.signOut();
      return { ok: false, error: { code: 'UNKNOWN', message: `档案写入失败: ${profileErr.message}` } };
    }

    this.profileCache.set(data.user.id, profile);
    return { ok: true, data: { user: this.toUser(data.user, profile), session: this.toSession(data.session) } };
  }

  async signIn(input: SignInInput): Promise<AuthResult<{ user: User; session: Session }>> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) return this.mapAuthError(error);
    if (!data.user || !data.session) {
      return { ok: false, error: { code: 'UNKNOWN', message: '登录未返回会话' } };
    }

    const profile = await this.fetchProfile(data.user.id);
    if (!profile) {
      return { ok: false, error: { code: 'UNKNOWN', message: '用户档案缺失' } };
    }

    // E2E 关键：校验本地 UMK 派生正确（顺带检测 salt 是否被篡改）
    const salt = fromBase64(profile.salt);
    if (!verifyPasswordCheck(input.password, salt, profile.password_check_envelope)) {
      return { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } };
    }

    return { ok: true, data: { user: this.toUser(data.user, profile), session: this.toSession(data.session) } };
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.profileCache.clear();
  }

  async getCurrentUser(): Promise<User | null> {
    const { data, error } = await this.supabase.auth.getUser();
    if (error || !data.user) return null;
    const profile = await this.fetchProfile(data.user.id);
    if (!profile) return null;
    return this.toUser(data.user, profile);
  }

  async getSession(): Promise<Session | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error || !data.session) return null;
    return this.toSession(data.session);
  }

  async refreshSession(): Promise<AuthResult<Session>> {
    const { data, error } = await this.supabase.auth.refreshSession();
    if (error) return this.mapAuthError(error);
    if (!data.session) return { ok: false, error: { code: 'UNKNOWN', message: '刷新未返回会话' } };
    return { ok: true, data: this.toSession(data.session) };
  }

  onAuthStateChange(listener: (session: Session | null) => void): () => void {
    const { data } = this.supabase.auth.onAuthStateChange((_event, session) => {
      listener(session ? this.toSession(session) : null);
    });
    return () => data.subscription.unsubscribe();
  }

  // ---------- 内部工具 ----------

  private async fetchProfile(userId: string): Promise<ProfileRow | null> {
    const cached = this.profileCache.get(userId);
    if (cached) return cached;
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error || !data) return null;
    const profile = data as ProfileRow;
    this.profileCache.set(userId, profile);
    return profile;
  }

  private toSession(s: SupabaseSession): Session {
    return {
      userId: s.user.id,
      email: s.user.email ?? '',
      accessToken: s.access_token,
      refreshToken: s.refresh_token,
      expiresAt: (s.expires_at ?? 0) * 1000,
    };
  }

  private toUser(u: SupabaseUser, profile: ProfileRow): User {
    return {
      id: u.id,
      email: u.email ?? profile.email,
      displayName: profile.display_name,
      salt: profile.salt,
      passwordCheckEnvelope: profile.password_check_envelope,
    };
  }

  private mapAuthError(e: AuthErrorLike): AuthResult<never> {
    // 网络错误：supabase-js 网络层失败时 status 为 0 / undefined
    if (e.status === 0 || e.status === undefined) {
      return { ok: false, error: { code: 'NETWORK', message: '网络异常，请稍后重试' } };
    }
    const code = e.code ?? '';
    if (code === 'invalid_credentials' || code === 'user_not_found') {
      return { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } };
    }
    if (code === 'user_already_exists' || code === 'email_exists' || code === 'email_taken') {
      return { ok: false, error: { code: 'USER_EXISTS', message: '该邮箱已注册' } };
    }
    if (code === 'weak_password') {
      return { ok: false, error: { code: 'UNKNOWN', message: '密码强度不足' } };
    }
    return { ok: false, error: { code: 'UNKNOWN', message: e.message } };
  }
}
