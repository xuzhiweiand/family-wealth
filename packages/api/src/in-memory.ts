/**
 * InMemoryAuthClient — W2 mock，便于单测
 *
 * 密码校验：用 PBKDF2-SHA256(password, salt) 与内存中的 passwordHash 对比
 * 不依赖任何外部服务
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from '@noble/hashes/utils';
import type { AuthClient, AuthResult, Session, SignInInput, SignUpInput, User } from './types';

interface StoredUser extends User {
  passwordHash: Uint8Array; // PBKDF2(password, salt) 的前 32 字节
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const PBKDF2_ITER = 100_000;
const encoder = new TextEncoder();

/** 计算密码哈希（与 @family-wealth/crypto 的 deriveUMK 一致） */
function hashPassword(password: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, encoder.encode(password), salt, { c: PBKDF2_ITER, dkLen: 32 });
}

function randomToken(prefix: string): string {
  const bytes = randomBytes(24);
  return `${prefix}_${Buffer.from(bytes).toString('hex')}`;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export class InMemoryAuthClient implements AuthClient {
  private users = new Map<string, StoredUser>(); // email -> user
  private usersById = new Map<string, StoredUser>();
  private sessions = new Map<string, Session>(); // accessToken -> session
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