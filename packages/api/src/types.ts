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

/**
 * 华为账号登录（Account Kit 授权登录，非一键登录）
 *
 * 客户端只拿到系统授权页回传的 authorization code，App Secret 仅在
 * Edge Function 环境变量中；服务端用 code 换取华为 token 与 openID。
 */
export interface HuaweiSignInInput {
  authorizationCode: string;
  /** 与授权请求一致的 state，用于防 CSRF */
  state: string;
  deviceId?: string;
}

/** 服务端加密档案（salt 与密码校验信封，均非机密） */
export interface HuaweiEncryptionProfile {
  salt: string;
  passwordCheckEnvelope: string;
}

export interface HuaweiAccount {
  userId: string;
  email: string;
  displayName: string;
  /** 是否为该 openID 首次登录 */
  isNewUser: boolean;
  /** 已有加密档案；null 表示首次使用，需要引导设置加密密码 */
  profile: HuaweiEncryptionProfile | null;
}

export interface HuaweiSignInResult {
  account: HuaweiAccount;
  session: Session;
}

/** 华为账号绑定到已有邮箱账号（登录时选择「绑定已有账号」） */
export interface HuaweiBindEmailInput extends HuaweiSignInInput {
  email: string;
  password: string;
}

/** 首次设置加密密码后写入服务端档案 */
export interface SaveEncryptionProfileInput {
  userId: string;
  email: string;
  displayName: string;
  salt: string;
  passwordCheckEnvelope: string;
}

export interface PhoneCodeResult {
  /** 仅本地兜底实现返回：开发模式下直接回显验证码 */
  devCode?: string;
}

export interface PhoneBindingResult {
  phone: string;
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
  /** 华为账号授权登录（服务端换 token → 建号/关联 → 签发会话） */
  signInWithHuawei(input: HuaweiSignInInput): Promise<AuthResult<HuaweiSignInResult>>;
  /** 华为授权 + 邮箱密码校验，把华为账号绑定到已有邮箱账号 */
  bindHuaweiToEmailAccount(input: HuaweiBindEmailInput): Promise<AuthResult<HuaweiSignInResult>>;
  /** 华为首次登录设置加密密码后，写入 salt + 密码校验信封 */
  saveEncryptionProfile(input: SaveEncryptionProfileInput): Promise<AuthResult<User>>;
  /** 发送手机号绑定验证码（Supabase Phone OTP） */
  sendPhoneBindingCode(phone: string): Promise<AuthResult<PhoneCodeResult>>;
  /** 校验验证码并完成手机号绑定 */
  confirmPhoneBinding(phone: string, code: string): Promise<AuthResult<PhoneBindingResult>>;
  signOut(): Promise<void>;
  /** 注销当前账号：删除服务端账号及其华为绑定关系，本地凭据由调用方清理 */
  deleteAccount(): Promise<AuthResult<null>>;
  getCurrentUser(): Promise<User | null>;
  getSession(): Promise<Session | null>;
  refreshSession(): Promise<AuthResult<Session>>;
  /** 监听认证状态变化（登录/登出/过期） */
  onAuthStateChange(listener: (session: Session | null) => void): () => void;
}