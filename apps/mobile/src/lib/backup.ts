/**
 * 本地加密备份（P0-2）—— 纯逻辑层
 *
 * 备份包格式（单文件 JSON，UTF-8）：
 * {
 *   kind: 'family-wealth-backup', version: 1, createdAt,
 *   kdf: { algo: 'PBKDF2-SHA256', iterations, salt },   // 内嵌 salt：恢复时凭密码重派生 UMK
 *   wrappedKey: envelope,                                // 随机备份密钥 BDK，用 UMK 包裹
 *   payload: envelope,                                   // 业务明文 JSON，用 BDK 加密
 * }
 *
 * 设计要点：
 * - 双层密钥：BDK 一次性随机生成、包裹后随包携带；UMK 永不落盘到备份文件。
 *   用户凭「登录密码 + 包内 salt」重派生 UMK 即可解包，改密码后旧备份仍可解
 *   （派生用的是包内历史 salt，与现网 salt 无关）。
 * - 两条 AAD 分别绑定包裹层与数据层，防止跨层重放。
 * - 恢复策略为「仅合并」：资产按 id 匹配、updatedAt 较新者胜出；快照为不可变
 *   记录，按 id 求并集。不产生半写入：解密+校验全部通过后才返回写入计划。
 */

import {
  encryptEnvelope,
  decryptEnvelope,
  generateRandomBytes,
  deriveUMKFast,
  toBase64,
  fromBase64,
  PBKDF2_ITERATIONS,
  type EncryptedRecord,
} from '@family-wealth/crypto';
import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';

export const BACKUP_FILE_KIND = 'family-wealth-backup';
export const BACKUP_FORMAT_VERSION = 1;

const AAD_WRAPPED_KEY = 'fw-backup-key:v1';
const AAD_PAYLOAD = 'fw-backup-payload:v1';

// ---------- 备份内容（解密后的业务明文） ----------

export interface BackupFamilyMeta {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  lastRotatedAt: string | null;
}

/** 家庭成员元数据（脱敏：不含 wrappedFdk，仅展示/核对用途，不参与恢复写入） */
export interface BackupMemberMeta {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
}

export interface BackupPayload {
  family: BackupFamilyMeta | null;
  members: BackupMemberMeta[];
  assets: Asset[];
  snapshots: AssetSnapshot[];
}

// ---------- 备份文件（磁盘 JSON 结构） ----------

interface EncryptedRecordJson {
  version: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface BackupFile {
  kind: typeof BACKUP_FILE_KIND;
  version: number;
  createdAt: string;
  kdf: {
    algo: 'PBKDF2-SHA256';
    iterations: number;
    /** base64；备份生成时当前用户的 per-user salt */
    salt: string;
  };
  wrappedKey: EncryptedRecordJson;
  payload: EncryptedRecordJson;
}

function recordToJson(r: EncryptedRecord): EncryptedRecordJson {
  return {
    version: r.version,
    iv: toBase64(r.iv),
    authTag: toBase64(r.authTag),
    ciphertext: toBase64(r.ciphertext),
  };
}

function recordFromJson(j: EncryptedRecordJson): EncryptedRecord {
  return {
    version: 1,
    iv: fromBase64(j.iv),
    authTag: fromBase64(j.authTag),
    ciphertext: fromBase64(j.ciphertext),
  };
}

// ---------- 打包 ----------

/**
 * 生成加密备份文件。
 * @param payload 全量家庭明文数据（含软删除资产，由调用方按「完整迁移」口径收集）
 * @param umk 当前内存态 UMK
 * @param saltBase64 当前用户 salt（base64，来自 Keychain；内嵌备份头供恢复时重派生）
 */
export function packBackup(
  payload: BackupPayload,
  umk: Uint8Array,
  saltBase64: string,
  now: Date = new Date(),
): BackupFile {
  const bdk = generateRandomBytes(32);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const wrappedKey = encryptEnvelope(bdk, umk, new TextEncoder().encode(AAD_WRAPPED_KEY));
  const data = encryptEnvelope(plaintext, bdk, new TextEncoder().encode(AAD_PAYLOAD));

  return {
    kind: BACKUP_FILE_KIND,
    version: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    kdf: { algo: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: saltBase64 },
    wrappedKey: recordToJson(wrappedKey),
    payload: recordToJson(data),
  };
}

export function serializeBackupFile(file: BackupFile): string {
  return JSON.stringify(file);
}

// ---------- 校验 ----------

function isRecordJson(v: unknown): v is EncryptedRecordJson {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r['version'] === 1 &&
    typeof r['iv'] === 'string' &&
    typeof r['authTag'] === 'string' &&
    typeof r['ciphertext'] === 'string'
  );
}

/** 解析并校验备份文件结构（不解密）。损坏/非备份文件抛友好错误 */
export function parseBackupFile(content: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('备份文件已损坏（不是有效的 JSON）');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('备份文件已损坏（结构不完整）');
  }
  const f = raw as Record<string, unknown>;
  if (f['kind'] !== BACKUP_FILE_KIND) {
    throw new Error('这不是家资备份文件，请重新选择');
  }
  if (typeof f['version'] !== 'number' || f['version'] < 1) {
    throw new Error('备份文件已损坏（缺少版本号）');
  }
  if (f['version'] > BACKUP_FORMAT_VERSION) {
    throw new Error('备份由更新版本的 App 生成，请升级后再恢复');
  }
  const kdf = f['kdf'] as Record<string, unknown> | undefined;
  if (
    !kdf ||
    kdf['algo'] !== 'PBKDF2-SHA256' ||
    typeof kdf['iterations'] !== 'number' ||
    typeof kdf['salt'] !== 'string'
  ) {
    throw new Error('备份文件已损坏（密钥信息不完整）');
  }
  if (!isRecordJson(f['wrappedKey']) || !isRecordJson(f['payload'])) {
    throw new Error('备份文件已损坏（加密数据不完整）');
  }
  return f as unknown as BackupFile;
}

// ---------- 解包 ----------

/**
 * 用登录密码解开备份。
 * 密码错误或文件被篡改 → 抛「密码不正确，或备份文件已被篡改」；
 * 解密成功但明文结构异常 → 抛「备份内容损坏」。
 */
export async function unpackBackup(file: BackupFile, password: string): Promise<BackupPayload> {
  const umk = await deriveUMKFast(password, fromBase64(file.kdf.salt));
  const aadKey = new TextEncoder().encode(AAD_WRAPPED_KEY);
  const aadPayload = new TextEncoder().encode(AAD_PAYLOAD);

  let plaintext: Uint8Array;
  try {
    const bdk = decryptEnvelope(recordFromJson(file.wrappedKey), umk, aadKey);
    plaintext = decryptEnvelope(recordFromJson(file.payload), bdk, aadPayload);
  } catch {
    throw new Error('密码不正确，或备份文件已被篡改');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('备份内容损坏（明文解析失败）');
  }
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p['assets']) || !Array.isArray(p['snapshots'])) {
    throw new Error('备份内容损坏（缺少资产或快照数据）');
  }
  return {
    family: (p['family'] as BackupFamilyMeta | null) ?? null,
    members: Array.isArray(p['members']) ? (p['members'] as BackupMemberMeta[]) : [],
    assets: p['assets'] as Asset[],
    snapshots: p['snapshots'] as AssetSnapshot[],
  };
}

// ---------- 合并计划（仅合并策略） ----------

export interface RestorePlan {
  /** 需要写入的资产（新增 + 备份侧较新） */
  assetsToApply: Asset[];
  /** 需要补写的快照（本地不存在的） */
  snapshotsToApply: AssetSnapshot[];
  counts: {
    assets: { added: number; updated: number; unchanged: number };
    snapshots: { added: number; existing: number };
  };
}

/**
 * 计算恢复写入计划。
 * - 资产：按 id 匹配；本地无 → 新增；备份 updatedAt 较新 → 更新；否则不动。
 *   ISO 时间串按字典序比较即时间序（统一 UTC Z 结尾）。
 * - 快照：不可变记录，按 id 并集补写，不做内容比较。
 */
export function planRestore(
  payload: BackupPayload,
  currentAssets: readonly Asset[],
  currentSnapshots: readonly AssetSnapshot[],
): RestorePlan {
  const assetById = new Map(currentAssets.map((a) => [a.id, a]));
  const snapshotIds = new Set(currentSnapshots.map((s) => s.id));

  const assetsToApply: Asset[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const a of payload.assets) {
    const local = assetById.get(a.id);
    if (!local) {
      added += 1;
      assetsToApply.push(a);
    } else if (a.updatedAt > local.updatedAt) {
      updated += 1;
      assetsToApply.push(a);
    } else {
      unchanged += 1;
    }
  }

  const snapshotsToApply: AssetSnapshot[] = [];
  let snapExisting = 0;
  for (const s of payload.snapshots) {
    if (snapshotIds.has(s.id)) {
      snapExisting += 1;
    } else {
      snapshotsToApply.push(s);
    }
  }

  return {
    assetsToApply,
    snapshotsToApply,
    counts: {
      assets: { added, updated, unchanged },
      snapshots: { added: snapshotsToApply.length, existing: snapExisting },
    },
  };
}
