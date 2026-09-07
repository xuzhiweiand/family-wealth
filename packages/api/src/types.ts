/**
 * Auth 抽象接口
 *
 * W2 实现 InMemoryAuthClient（单测友好）
 * W3 实现 SupabaseAuthClient（基于 @supabase/supabase-js）
 */

export interface User {
  id: string;
  email: string;
  displayName: string;
  /** 服务端 per-user salt（用于本地派生 UMK） */
  salt: string;
  /** 公共密码校验信封（用 UMK 加密的固定明文，验证密码正确性） */
  passwordCheckEnvelope: string; // base64
}

export interface Session {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'USER_EXISTS'
  | 'NETWORK'
  | 'UNKNOWN';

export interface AuthResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: AuthErrorCode; message: string };
}

export interface AuthClient {
  signUp(input: SignUpInput): Promise<AuthResult<{ user: User; session: Session }>>;
  signIn(input: SignInInput): Promise<AuthResult<{ user: User; session: Session }>>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
  getSession(): Promise<Session | null>;
  refreshSession(): Promise<AuthResult<Session>>;
  /** 监听认证状态变化（登录/登出/过期） */
  onAuthStateChange(listener: (session: Session | null) => void): () => void;
}