/**
 * 安全存储（react-native-keychain）
 *
 * 用系统钥匙串（iOS Keychain / Android Keystore）持久化：
 * - 服务端 salt（base64）：离线重派生 UMK 所需，非机密但需防篡改
 * - 会话 token（access / refresh）：重启后免登录
 *
 * ⚠️ 依赖 react-native-keychain（native 模块），需 prebuild 后 `pnpm install`。
 *    本机沙箱无法安装该包，mobile 端 typecheck 在正常机器上验证。
 */

import * as Keychain from 'react-native-keychain';

const SALT_SERVICE = 'family-wealth.salt';
const SESSION_SERVICE = 'family-wealth.session';

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

/** 一键清空所有持久化凭据 */
export async function clearAll(): Promise<void> {
  await Promise.all([clearSalt(), clearSession()]);
}
