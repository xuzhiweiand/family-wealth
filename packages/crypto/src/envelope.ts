/**
 * 信封加密（AES-256-GCM）
 *
 * 每条加密记录独立 IV；AAD 绑定 familyId/assetId 等上下文
 * 防止重放与跨家庭/跨字段串改。
 */

import { gcm } from '@noble/ciphers/aes';
import { generateRandomBytes } from './kdf';

export const IV_BYTES = 12;
export const AUTH_TAG_BYTES = 16;
export const KEY_BYTES = 32; // AES-256

/** 加密记录（存服务端/本地） */
export interface EncryptedRecord {
  /** 协议版本，便于未来升级 */
  version: 1;
  /** AES-GCM IV（96 bit） */
  iv: Uint8Array;
  /** AES-GCM 认证标签（128 bit） */
  authTag: Uint8Array;
  /** 密文 */
  ciphertext: Uint8Array;
}

/** 协议升级用：当前支持的最高版本 */
export const ENVELOPE_VERSION = 1 as const;

/**
 * 用 key（FDK）加密 plaintext，绑定 aad（additional authenticated data）
 *
 * @param plaintext 明文（任意字节）
 * @param key 32 字节密钥（FDK）
 * @param aad 绑定上下文（如 `family:${familyId}`）
 */
export function encryptEnvelope(plaintext: Uint8Array, key: Uint8Array, aad: Uint8Array = new Uint8Array()): EncryptedRecord {
  if (key.length !== KEY_BYTES) {
    throw new Error(`key must be ${KEY_BYTES} bytes`);
  }
  const iv = generateRandomBytes(IV_BYTES);
  const cipher = gcm(key, iv, aad);
  const sealed = cipher.encrypt(plaintext);
  // @noble/ciphers 的 gcm.encrypt 返回 ciphertext || authTag
  const ciphertext = sealed.slice(0, sealed.length - AUTH_TAG_BYTES);
  const authTag = sealed.slice(sealed.length - AUTH_TAG_BYTES);
  return { version: ENVELOPE_VERSION, iv, authTag, ciphertext };
}

/**
 * 解密 envelope；失败抛 Error（含 AAD 验证、authTag 验证）
 */
export function decryptEnvelope(record: EncryptedRecord, key: Uint8Array, aad: Uint8Array = new Uint8Array()): Uint8Array {
  if (record.version !== ENVELOPE_VERSION) {
    throw new Error(`unsupported envelope version: ${record.version}`);
  }
  if (record.iv.length !== IV_BYTES) {
    throw new Error(`invalid IV length: ${record.iv.length}`);
  }
  if (record.authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(`invalid authTag length: ${record.authTag.length}`);
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`key must be ${KEY_BYTES} bytes`);
  }
  // 重组 sealed = ciphertext || authTag
  const sealed = new Uint8Array(record.ciphertext.length + record.authTag.length);
  sealed.set(record.ciphertext, 0);
  sealed.set(record.authTag, record.ciphertext.length);
  try {
    return gcm(key, record.iv, aad).decrypt(sealed);
  } catch (err) {
    throw new Error(`decryption failed (likely tampered or wrong AAD/key): ${(err as Error).message}`);
  }
}

/**
 * 安全擦除内存中的密钥（用 0 覆盖）
 * 注意：JS 引擎可能复制内存，本函数只能降低被 dump 概率
 */
export function wipeBytes(buf: Uint8Array): void {
  for (let i = 0; i < buf.length; i++) buf[i] = 0;
}