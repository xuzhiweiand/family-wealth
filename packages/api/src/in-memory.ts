/**
 * InMemoryAuthClient — 开发兜底 + 单测 fixture（无 env 配置时使用，见 mobile bootstrap.ts）
 *
 * 密码校验：用 PBKDF2-SHA256(password, salt) 与内存中的 passwordHash 对比
 * 不依赖任何外部服务
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { fromBase64, toBase64 } from '@family-wealth/crypto';
import type {
  AuthClient,
  AuthResult,
  HuaweiBindEmailInput,
  HuaweiSignInInput,
  HuaweiSignInResult,
  PhoneBindingResult,
  PhoneCodeResult,
  SaveEncryptionProfileInput,
  Session,
  SignInInput,
  SignUpInput,
  User,
} from './types';

interface StoredUser extends User {
  passwordHash: Uint8Array; // PBKDF2(password, salt) 的前 32 字节
}

interface PendingHuawei {
  userId: string;
  openId: string;
  email: string;
  displayName: string;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const PHONE_CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const PBKDF2_ITER = 100_000;
const encoder = new TextEncoder();
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

/** 计算密码哈希（与 @family-wealth/crypto 的 deriveUMK 一致） */
function hashPassword(password: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, encoder.encode(password), salt, { c: PBKDF2_ITER, dkLen: 32 });
}

function randomToken(prefix: string): string {
  const bytes = randomBytes(24);
  return `${prefix}_${bytesToHex(bytes)}`;
}

export class InMemoryAuthClient implements AuthClient {
  private users = new Map<string, StoredUser>(); // email -> user
  private usersById = new Map<string, StoredUser>();
  private sessions = new Map<string, Session>(); // accessToken -> session
  /** openId -> userId（与服务端一致：登录即建立关联，即使还没设置加密密码） */
  private huaweiByOpenId = new Map<string, string>();
  private pendingHuawei = new Map<string, PendingHuawei>(); // userId -> 待设置密码
  private phoneCodes = new Map<string, { code: string; expiresAt: number }>();
  private listeners = new Set<(s: Session | null) => void>();
  private currentSession: Session | null = null;

  async signUp(input: SignUpInput): Promise<AuthResult<{ user: User; session: Session }>> {
    if (this.users.has(input.email.toLowerCase())) {
      return { ok: false, error: { code: 'USER_EXISTS', message: '该邮箱已注册' } };
    }
    const salt = randomBytes(16);
    const passwordHash = hashPassword(input.password, salt);
    const user: StoredUser = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      salt: toBase64(salt),
      // 用 passwordHash 自身作为校验信封（加密密码哈希自身）
      passwordCheckEnvelope: toBase64(passwordHash),
      passwordHash,
    };
    this.users.set(user.email, user);
    this.usersById.set(user.id, user);

    const session: Session = {
      userId: user.id,
      email: user.email,
      accessToken: randomToken('at'),
      refreshToken: randomToken('rt'),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(session.accessToken, session);
    this.currentSession = session;
    this.emit(session);

    const publicUser: User = this.toPublic(user);
    return { ok: true, data: { user: publicUser, session } };
  }

  async signIn(input: SignInInput): Promise<AuthResult<{ user: User; session: Session }>> {
    const user = this.users.get(input.email.toLowerCase());
    if (!user) {
      return { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } };
    }
    const salt = fromBase64(user.salt);
    const candidate = hashPassword(input.password, salt);
    if (!constantTimeEqual(candidate, user.passwordHash)) {
      return { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } };
    }
    const session: Session = {
      userId: user.id,
      email: user.email,
      accessToken: randomToken('at'),
      refreshToken: randomToken('rt'),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(session.accessToken, session);
    this.currentSession = session;
    this.emit(session);
    return { ok: true, data: { user: this.toPublic(user), session } };
  }

  async signInWithHuawei(input: HuaweiSignInInput): Promise<AuthResult<HuaweiSignInResult>> {
    const openId = input.authorizationCode.trim();
    if (!openId || !input.state.trim()) {
      return { ok: false, error: { code: 'UNKNOWN', message: '授权信息不完整，请重新授权' } };
    }

    const ownerId = this.huaweiByOpenId.get(openId);
    if (ownerId) {
      const existing = this.usersById.get(ownerId);
      // 已设置加密密码：返回档案；仍在 pending：返回空档案（客户端据此展示设置页）
      const account = existing
        ? {
            userId: existing.id,
            email: existing.email,
            displayName: existing.displayName,
            isNewUser: false,
            profile: { salt: existing.salt, passwordCheckEnvelope: existing.passwordCheckEnvelope },
          }
        : (() => {
            const pending = this.pendingHuawei.get(ownerId)!;
            return {
              userId: pending.userId,
              email: pending.email,
              displayName: pending.displayName,
              isNewUser: true,
              profile: null,
            };
          })();
      return {
        ok: true,
        data: { account, session: this.createSession(account.userId, account.email) },
      };
    }

    // 首次登录：先建「待设置加密密码」的临时账号，并立即绑定 openID（同服务端）
    const userId = `hw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const email = `hw_${bytesToHex(randomBytes(4))}@huawei.local`;
    const displayName = '华为用户';
    this.pendingHuawei.set(userId, { userId, openId, email, displayName });
    this.huaweiByOpenId.set(openId, userId);

    return {
      ok: true,
      data: {
        account: { userId, email, displayName, isNewUser: true, profile: null },
        session: this.createSession(userId, email),
      },
    };
  }

  async bindHuaweiToEmailAccount(input: HuaweiBindEmailInput): Promise<AuthResult<HuaweiSignInResult>> {
    const openId = input.authorizationCode.trim();
    if (!openId || !input.state.trim()) {
      return { ok: false, error: { code: 'UNKNOWN', message: '授权信息不完整，请重新授权' } };
    }
    const email = input.email.toLowerCase();
    const user = this.users.get(email);
    if (!user || user.passwordHash.length === 0) {
      return { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } };
    }
    const candidate = hashPassword(input.password, fromBase64(user.salt));
    if (!constantTimeEqual(candidate, user.passwordHash)) {
      return { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' } };
    }
    const ownerId = this.huaweiByOpenId.get(openId);
    if (ownerId && ownerId !== user.id) {
      // 已设置过加密密码的账号才算真实冲突；未设密码的临时账号允许被覆盖
      if (this.usersById.has(ownerId)) {
        return { ok: false, error: { code: 'UNKNOWN', message: '该华为账号已绑定其他账号，请先解绑' } };
      }
      this.pendingHuawei.delete(ownerId);
    }
    this.huaweiByOpenId.set(openId, user.id);
    return {
      ok: true,
      data: {
        account: {
          userId: user.id,
          email: user.email,
          displayName: user.displayName,
          isNewUser: false,
          profile: { salt: user.salt, passwordCheckEnvelope: user.passwordCheckEnvelope },
        },
        session: this.createSession(user.id, user.email),
      },
    };
  }

  async saveEncryptionProfile(input: SaveEncryptionProfileInput): Promise<AuthResult<User>> {
    const pending = this.pendingHuawei.get(input.userId);
    const user: StoredUser = {
      id: input.userId,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      salt: input.salt,
      passwordCheckEnvelope: input.passwordCheckEnvelope,
      // 华为账号登录不持有明文密码，邮箱密码路径无法复用该账号
      passwordHash: new Uint8Array(0),
    };

    this.users.set(user.email, user);
    this.usersById.set(user.id, user);
    if (pending) {
      this.huaweiByOpenId.set(pending.openId, user.id);
      this.pendingHuawei.delete(input.userId);
    }
    return { ok: true, data: this.toPublic(user) };
  }

  async sendPhoneBindingCode(phone: string): Promise<AuthResult<PhoneCodeResult>> {
    if (!PHONE_PATTERN.test(phone)) {
      return { ok: false, error: { code: 'UNKNOWN', message: '请输入正确的 11 位手机号' } };
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.phoneCodes.set(phone, { code, expiresAt: Date.now() + PHONE_CODE_TTL_MS });
    // 本地兜底实现没有短信网关，回显验证码供联调
    return { ok: true, data: { devCode: code } };
  }

  async confirmPhoneBinding(phone: string, code: string): Promise<AuthResult<PhoneBindingResult>> {
    const entry = this.phoneCodes.get(phone);
    if (!entry || entry.expiresAt < Date.now() || entry.code !== code) {
      return { ok: false, error: { code: 'UNKNOWN', message: '验证码错误或已过期' } };
    }
    this.phoneCodes.delete(phone);
    return { ok: true, data: { phone } };
  }

  async deleteAccount(): Promise<AuthResult<null>> {
    if (!this.currentSession) {
      return { ok: false, error: { code: 'UNKNOWN', message: '请先登录后再注销账号' } };
    }
    const userId = this.currentSession.userId;
    const user = this.usersById.get(userId);
    // 首次华为登录尚未设置加密密码时账号只在 pendingHuawei 中，同样允许注销
    if (!user && !this.pendingHuawei.has(userId)) {
      return { ok: false, error: { code: 'UNKNOWN', message: '账号不存在或已注销' } };
    }

    if (user) this.users.delete(user.email);
    this.usersById.delete(userId);
    for (const [openId, boundUserId] of this.huaweiByOpenId) {
      if (boundUserId === userId) this.huaweiByOpenId.delete(openId);
    }
    this.pendingHuawei.delete(userId);

    const token = this.currentSession.accessToken;
    this.sessions.delete(token);
    this.currentSession = null;
    this.emit(null);
    return { ok: true, data: null };
  }

  async signOut(): Promise<void> {
    if (this.currentSession) {
      this.sessions.delete(this.currentSession.accessToken);
      this.currentSession = null;
      this.emit(null);
    }
  }

  async getCurrentUser(): Promise<User | null> {
    if (!this.currentSession) return null;
    const u = this.usersById.get(this.currentSession.userId);
    return u ? this.toPublic(u) : null;
  }

  async getSession(): Promise<Session | null> {
    if (!this.currentSession) return null;
    if (this.currentSession.expiresAt < Date.now()) return null;
    return this.currentSession;
  }

  async refreshSession(): Promise<AuthResult<Session>> {
    if (!this.currentSession) {
      return { ok: false, error: { code: 'UNKNOWN', message: '无活跃会话' } };
    }
    const newSession: Session = {
      ...this.currentSession,
      accessToken: randomToken('at'),
      refreshToken: randomToken('rt'),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    // 保证 expiresAt 一定大于旧值（避免同毫秒内 Date.now() 重复）
    if (newSession.expiresAt <= this.currentSession.expiresAt) {
      newSession.expiresAt = this.currentSession.expiresAt + 1000;
    }
    this.sessions.delete(this.currentSession.accessToken);
    this.sessions.set(newSession.accessToken, newSession);
    this.currentSession = newSession;
    this.emit(newSession);
    return { ok: true, data: newSession };
  }

  onAuthStateChange(listener: (s: Session | null) => void): () => void {
    this.listeners.add(listener);
    // 不立即调用 listener：业内惯例（firebase/supabase）只在状态变化时触发
    return () => {
      this.listeners.delete(listener);
    };
  }

  private createSession(userId: string, email: string): Session {
    const session: Session = {
      userId,
      email,
      accessToken: randomToken('at'),
      refreshToken: randomToken('rt'),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(session.accessToken, session);
    this.currentSession = session;
    this.emit(session);
    return session;
  }

  private toPublic(u: StoredUser): User {
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      salt: u.salt,
      passwordCheckEnvelope: u.passwordCheckEnvelope,
    };
  }

  private emit(s: Session | null): void {
    for (const l of this.listeners) l(s);
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}