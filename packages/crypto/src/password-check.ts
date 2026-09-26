/**
 * 密码校验信封（password check envelope）
 *
 * 用途：客户端登录后，用本地派生的 UMK 校验「密码 → UMK」派生是否正确，
 * 全程不向服务端泄露明文或任何密钥。
 *
 * 机制：取一个固定明文常量，用 UMK 经 AES-256-GCM 加密成 envelope，
 * 序列化为字符串后存到服务端 profiles 表。登录时拉回该 envelope 解密，
 * 若明文匹配则说明 UMK 派生正确（同时能检测 salt 是否被篡改）。
 *
 * envelope 序列化格式（JSON 字符串，字段均为 base64）：
 *   { "v": 1, "iv": "...", "tag": "...", "ct": "..." }
 */

import { deriveUMK } from './kdf';
import { encryptEnvelope, decryptEnvelope, type EncryptedRecord } from './envelope';
import { toBase64, fromBase64 } from './encoding';

/** 固定明文常量（带版本号，便于未来协议升级） */
export const PASSWORD_CHECK_PLAINTEXT = 'family-wealth:password-check:v1';

/** 由密码 + salt 生成校验信封（返回可直接存库的字符串） */
export function createPasswordCheckEnvelope(password: string, salt: Uint8Array): string {
  const umk = deriveUMK(password, salt);
  try {
    return createPasswordCheckEnvelopeWithUMK(umk);
  } finally {
    // 立即擦除 UMK，避免残留在堆上
    for (let i = 0; i < umk.length; i++) umk[i] = 0;
  }
}

/** 用预派生的 UMK 生成校验信封（跳过 PBKDF2，调用方负责 UMK 生命周期） */
export function createPasswordCheckEnvelopeWithUMK(umk: Uint8Array): string {
  const plaintext = new TextEncoder().encode(PASSWORD_CHECK_PLAINTEXT);
  const record = encryptEnvelope(plaintext, umk);
  return serializeEnvelope(record);
}

/** 校验密码 + salt 是否能解出固定明文（返回 true 表示 UMK 派生正确） */
export function verifyPasswordCheck(password: string, salt: Uint8Array, envelope: string): boolean {
  const umk = deriveUMK(password, salt);
  try {
    return verifyEnvelopeWithUMK(umk, envelope);
  } finally {
    for (let i = 0; i < umk.length; i++) umk[i] = 0;
  }
}

/**
 * 用预派生的 UMK 校验密码信封（跳过 PBKDF2，调用方负责 UMK 生命周期）
 *
 * 用途：SupabaseAuthClient.signIn 需要同时校验信封和获取 UMK，
 * 先调 deriveUMK 一次，再用本函数校验，避免 verifyPasswordCheck + deriveUMK
 * 双重 PBKDF2（在无 JIT 的 Hermes 上每次 100k 迭代耗时数分钟）。
 */
export function verifyEnvelopeWithUMK(umk: Uint8Array, envelope: string): boolean {
  try {
    const record = deserializeEnvelope(envelope);
    if (!record) return false;
    const plaintext = decryptEnvelope(record, umk);
    const expected = new TextEncoder().encode(PASSWORD_CHECK_PLAINTEXT);
    if (plaintext.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < plaintext.length; i++) diff |= plaintext[i]! ^ expected[i]!;
    return diff === 0;
  } catch {
    return false;
  }
}

/** Envelope → JSON 字符串（可存 text 列） */
export function serializeEnvelope(record: EncryptedRecord): string {
  return JSON.stringify({
    v: record.version,
    iv: toBase64(record.iv),
    tag: toBase64(record.authTag),
    ct: toBase64(record.ciphertext),
  });
}

/** JSON 字符串 → Envelope；解析失败返回 null */
export function deserializeEnvelope(s: string): EncryptedRecord | null {
  try {
    const parsed = JSON.parse(s) as { v: number; iv: string; tag: string; ct: string };
    if (parsed.v !== 1 || typeof parsed.iv !== 'string' || typeof parsed.tag !== 'string' || typeof parsed.ct !== 'string') {
      return null;
    }
    return {
      version: 1,
      iv: fromBase64(parsed.iv),
      authTag: fromBase64(parsed.tag),
      ciphertext: fromBase64(parsed.ct),
    };
  } catch {
    return null;
  }
}
