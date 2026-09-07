/**
 * 同步记录的加解密编解码
 *
 * AAD 绑定 `family:<id>`：即使有人把 A 家庭的密文搬到 B 家庭（或搬到别的字段），
 * GCM 认证也会失败——这是端到端加密下防止"密文重放/串改"的关键一环。
 */

import { decryptEnvelope, deserializeEnvelope, encryptEnvelope, serializeEnvelope } from '@family-wealth/crypto';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function buildAad(familyId: string): Uint8Array {
  return encoder.encode(`family:${familyId}`);
}

/** 明文对象 → 密文字符串 */
export function encodeRecord(payload: unknown, fdk: Uint8Array, aad: Uint8Array): string {
  const plaintext = encoder.encode(JSON.stringify(payload));
  return serializeEnvelope(encryptEnvelope(plaintext, fdk, aad));
}

/**
 * 密文字符串 → 明文对象
 *
 * @returns 解密/解析失败返回 null（被篡改、密钥不对、版本不支持），**不抛异常** ——
 *          同步循环里一行坏数据不该拖垮整批。
 */
export function decodeRecord<T>(envelope: string, fdk: Uint8Array, aad: Uint8Array): T | null {
  const record = deserializeEnvelope(envelope);
  if (record === null) return null;
  try {
    const plaintext = decryptEnvelope(record, fdk, aad);
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return null;
  }
}
