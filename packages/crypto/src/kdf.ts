/**
 * 密钥派生函数（KDF）
 *
 * UMK: 由用户密码 + 服务端 salt 经 PBKDF2-SHA256 派生（100k 迭代）
 * FDK: 由 UMK + familyId 经 HKDF-SHA256 派生（用于家庭数据加密）
 *
 * 安全参数选择依据：
 * - PBKDF2 100k：RN 端 < 200ms 完成（见技术方案 §3 性能预算）
 * - HKDF 用 UMK 自身作 salt（标准做法，避免密钥分层带来的额外熵要求）
 *
 * ⚠️ 安全警告：派生过程必须是 constant-time，@noble/hashes 默认符合
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { hkdf } from '@noble/hashes/hkdf';
import { randomBytes as random } from '@noble/hashes/utils';

/** UMK 字节数（256 bit） */
export const UMK_BYTES = 32;
/** FDK 字节数（256 bit） */
export const FDK_BYTES = 32;
/** 服务端 salt 字节数 */
export const SALT_BYTES = 16;

/** PBKDF2 迭代次数。MVP 默认 100k；W3 在真机上跑基准再定最终值 */
export const PBKDF2_ITERATIONS = 100_000;

/**
 * 从用户密码派生 UMK
 * @param password 用户密码（UTF-8 string）
 * @param salt 服务端 per-user salt（至少 16 字节）
 */
export function deriveUMK(password: string, salt: Uint8Array): Uint8Array {
  if (salt.length < SALT_BYTES) {
    throw new Error(`salt must be at least ${SALT_BYTES} bytes`);
  }
  const encoder = new TextEncoder();
  return pbkdf2(sha256, encoder.encode(password), salt, { c: PBKDF2_ITERATIONS, dkLen: UMK_BYTES });
}

/**
 * 从 UMK 派生家庭数据密钥（FDK）
 * @param umk 用户主密钥
 * @param familyId 家庭 ID（AAD 绑定，避免跨家庭重放）
 */
export function deriveFDK(umk: Uint8Array, familyId: string): Uint8Array {
  const encoder = new TextEncoder();
  return hkdf(sha256, umk, umk, encoder.encode(`fdk:${familyId}`), FDK_BYTES);
}

/** 生成密码学安全随机字节（用于 IV、salt 等） */
export function generateRandomBytes(length: number): Uint8Array {
  return random(length);
}

/** 生成密码学安全 salt（服务端 per-user 持久化） */
export function generateSalt(): Uint8Array {
  return generateRandomBytes(SALT_BYTES);
}

/** 常数时间比较，避免 timing attack */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}