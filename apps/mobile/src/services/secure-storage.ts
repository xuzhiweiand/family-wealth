/**
 * 安全存储（react-native-keychain）
 *
 * 用系统钥匙串（iOS Keychain / Android Keystore）持久化：
 * - 服务端 salt（base64）：离线重派生 UMK 所需，非机密但需防篡改
 * - 会话 token（access / refresh）：重启后免登录
 * - UMK（base64）：重启后恢复加密能力（FDK 派生），无需重输密码
 * - 用户档案 JSON：重启后直接回填 user，免去网络拉取
 *
 * ⚠️ 依赖 react-native-keychain（native 模块），需 prebuild 后 `pnpm install`。
 */

import * as Keychain from 'react-native-keychain';

const SALT_SERVICE = 'family-wealth.salt';
const SESSION_SERVICE = 'family-wealth.session';
const UMK_SERVICE = 'family-wealth.umk';
const USER_SERVICE = 'family-wealth.user';

/** 持久化服务端 salt（用于离线重派生 UMK） */
export async function saveSalt(salt: string): Promise<void> {
  await Keychain.setGenericPassword('salt', salt, { service: SALT_SERVICE });
}

/** 读取服务端 salt；未存过则返回 null */
export async function getSalt(): Promise<string | null> {
  const result = await Keychain.getGenericPassword({ service: SALT_SERVICE });
  if (result === false) return null;
  return result.password;
}

/** 清除 salt（退出登录/改密时调用） */
export async function clearSalt(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SALT_SERVICE });
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/** 持久化会话 token */
export async function saveSession(tokens: SessionTokens): Promise<void> {
  await Keychain.setGenericPassword(tokens.accessToken, tokens.refreshToken, {
    service: SESSION_SERVICE,
  });
}

/** 读取会话 token；未存过则返回 null */
export async function getSessionTokens(): Promise<SessionTokens | null> {
  const result = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
  if (result === false) return null;
  return { accessToken: result.username, refreshToken: result.password };
}

/** 清除会话 token */
export async function clearSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
}

// ---------- UMK 持久化（重启后恢复加密能力） ----------

/** 持久化 UMK（base64），重启后直接读取，无需密码重派生 */
export async function saveUmk(umkBase64: string): Promise<void> {
  await Keychain.setGenericPassword('umk', umkBase64, { service: UMK_SERVICE });
}

/** 读取 UMK（base64）；未存过则返回 null */
export async function getUmk(): Promise<string | null> {
  const result = await Keychain.getGenericPassword({ service: UMK_SERVICE });
  if (result === false) return null;
  return result.password;
}

/** 清除 UMK */
export async function clearUmk(): Promise<void> {
  await Keychain.resetGenericPassword({ service: UMK_SERVICE });
}

// ---------- 用户档案持久化（免网络回填） ----------

/** 持久化用户档案 JSON */
export async function saveUser(userJson: string): Promise<void> {
  await Keychain.setGenericPassword('user', userJson, { service: USER_SERVICE });
}

/** 读取用户档案 JSON；未存过则返回 null */
export async function getUser(): Promise<string | null> {
  const result = await Keychain.getGenericPassword({ service: USER_SERVICE });
  if (result === false) return null;
  return result.password;
}

/** 清除用户档案 */
export async function clearUser(): Promise<void> {
  await Keychain.resetGenericPassword({ service: USER_SERVICE });
}

/** 一键清空所有持久化凭据 */
export async function clearAll(): Promise<void> {
  await Promise.all([clearSalt(), clearSession(), clearUmk(), clearUser()]);
}
