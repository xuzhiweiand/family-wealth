/**
 * 密钥轮换（UMK 改密 / FDK 重分发）
 *
 * 设计原则：re-wrap 而非重新加密
 * - envelope 仍用 FDK_new 加密，只是换 key
 * - 业务层不需要重传数据到服务端
 */

import { deriveUMK, deriveFDK, generateRandomBytes } from './kdf';
import { encryptEnvelope, decryptEnvelope, type EncryptedRecord, IV_BYTES } from './envelope';

/** 轮换结果：包含新 envelope 与 FDK_new（若需分发给他人，可加密导出） */
export interface RotationResult {
  /** 重加密后的 envelope（用 FDK_new） */
  reEncrypted: EncryptedRecord;
  /** 新 IV 是否与旧 IV 不同（必为 true） */
  ivChanged: boolean;
}

/**
 * 用新 FDK 重新加密单条 envelope（不改密文，只换 key + IV）
 *
 * @param record 旧 envelope
 * @param oldFdk 旧 FDK
 * @param newFdk 新 FDK
 * @param aad AAD（必须保持一致，否则解密失败）
 */
export function rewrapEnvelope(
  record: EncryptedRecord,
  oldFdk: Uint8Array,
  newFdk: Uint8Array,
  aad: Uint8Array = new Uint8Array(),
): RotationResult {
  const plaintext = decryptEnvelope(record, oldFdk, aad);
  const reEncrypted = encryptEnvelope(plaintext, newFdk, aad);
  // 安全要求：GCM 的 (key, IV) 对必须唯一，重加密必换 IV
  const ivChanged = !constantTimeEqualBytes(record.iv, reEncrypted.iv);
  if (!ivChanged) {
    throw new Error('IV reuse detected after re-encryption; this is a critical security failure');
  }
  // 立即擦除明文
  for (let i = 0; i < plaintext.length; i++) plaintext[i] = 0;
  return { reEncrypted, ivChanged };
}

/** 批量 rewrap（用户改密码场景） */
export function rewrapMany(
  records: EncryptedRecord[],
  oldFdk: Uint8Array,
  newFdk: Uint8Array,
  aadFor: (idx: number) => Uint8Array = () => new Uint8Array(),
): EncryptedRecord[] {
  return records.map((r, i) => rewrapEnvelope(r, oldFdk, newFdk, aadFor(i)).reEncrypted);
}

/** 完整改密流程：旧密码 → 新密码 + 所有 FDK 重派生 */
export interface PasswordChangeInputs {
  oldPassword: string;
  newPassword: string;
  oldSalt: Uint8Array; // 服务端返回
  newSalt: Uint8Array; // 新生成
  familyIds: string[];
}

export interface PasswordChangeOutputs {
  newUmk: Uint8Array;
  newFdks: Map<string, Uint8Array>; // familyId → FDK
}

export function changePassword(inputs: PasswordChangeInputs): PasswordChangeOutputs {
  const newUmk = deriveUMK(inputs.newPassword, inputs.newSalt);
  const fdks = new Map<string, Uint8Array>();
  for (const fid of inputs.familyIds) fdks.set(fid, deriveFDK(newUmk, fid));
  return { newUmk, newFdks: fdks };
}

/** 内部工具：常数时间字节比较 */
function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** 工具：生成新 salt（轮换后给服务端存） */
export function newSaltForRotation(): Uint8Array {
  return generateRandomBytes(16);
}

/** IV_BYTES 导出供 UI 层展示 */
export { IV_BYTES };