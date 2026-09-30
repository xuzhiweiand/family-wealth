/**
 * 本地加密备份与恢复（P0-2）—— 编排层
 *
 * 备份：收集全量家庭明文（含软删除资产、含其他成员私密资产——
 * 完整迁移口径，备份包本身加密，保管责任在用户）→ packBackup 加密 →
 * file-export.ts 统一通道（Android 系统分享 / 鸿蒙系统另存为）。
 *
 * 恢复：file-import.ts 选文件 → parseBackupFile 结构校验 →
 * 用户输入登录密码解包（包内 salt 重派生 UMK，改密码后旧备份仍可解）→
 * planRestore 预览（新增/更新/不变）→ 用户确认 → applyRestore
 * 写本地仓储 + 入队云端上行 + 刷新 UI。解密校验全部通过前不写任何数据，
 * 不会产生半写入状态（验收 5）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { assetRepository, snapshotRepository } from './bootstrap';
import { useKeyStore } from '../stores/key-store';
import { useFamilyStore } from '../stores/family-store';
import { useAssetStore } from '../stores/asset-store';
import { getSalt } from './secure-storage';
import { enqueueChange } from './sync';
import { exportFile, type FileExportResult } from './file-export';
import { pickTextFile } from './file-import';
import {
  packBackup,
  serializeBackupFile,
  parseBackupFile,
  unpackBackup,
  planRestore,
  type BackupFile,
  type BackupPayload,
  type RestorePlan,
} from '../lib/backup';

const LAST_BACKUP_KEY = 'family-wealth.last-backup-at';

/** 最近一次成功备份的时间（ISO）；没有过备份返回 null */
export async function getLastBackupAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

/** 备份文件名：可读、含日期时间，如 家资备份-2026-09-30_14-30.json */
export function buildBackupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
  return `家资备份-${date}_${time}.json`;
}

/**
 * 生成加密备份包并交给系统导出通道。
 * 成功（shared/saved）时记录最近备份时间；用户取消不记录。
 */
export async function createBackup(now: Date = new Date()): Promise<FileExportResult> {
  const umk = useKeyStore.getState().umk;
  if (!umk) throw new Error('登录态异常：密钥未解锁，请重新登录后再备份');
  const family = useFamilyStore.getState().family;
  if (!family) throw new Error('尚未加入家庭，请先创建或加入家庭');
  const salt = await getSalt();
  if (!salt) throw new Error('登录态异常：缺少安全参数，请重新登录后再备份');

  // 全量口径：includeDeleted 保留软删除记录，保证换机迁移一条不丢
  const [assets, snapshots] = await Promise.all([
    assetRepository.list({ familyId: family.id, includeDeleted: true }),
    snapshotRepository.list({ familyId: family.id }),
  ]);
  if (assets.length === 0) throw new Error('还没有资产数据，先录入几笔再备份');

  // 成员元数据仅作核对展示：剥掉 wrappedFdk（他人的密钥包裹体不该进备份包）
  const members = useFamilyStore.getState().members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    role: m.role as string,
    joinedAt: m.joinedAt,
  }));

  const file = packBackup({ family: { ...family }, members, assets, snapshots }, umk, salt, now);
  const result = await exportFile(
    buildBackupFileName(now),
    serializeBackupFile(file),
    'application/json',
  );
  if (result.status !== 'cancelled') {
    await AsyncStorage.setItem(LAST_BACKUP_KEY, file.createdAt).catch(() => undefined);
  }
  return result;
}

export interface PickedBackup {
  file: BackupFile;
  /** 用户选择的文件名（展示用） */
  name: string;
}

/** 选择并校验备份文件；用户取消返回 null；损坏文件抛友好错误 */
export async function pickBackup(): Promise<PickedBackup | null> {
  const picked = await pickTextFile();
  if (!picked) return null;
  return { file: parseBackupFile(picked.content), name: picked.name };
}

/** 用登录密码解包（密码错误/篡改 → 抛错；见 lib/backup.ts） */
export async function decryptBackup(
  file: BackupFile,
  password: string,
): Promise<BackupPayload> {
  return unpackBackup(file, password);
}

export interface RestorePreview {
  plan: RestorePlan;
  familyId: string;
  /** 备份内记录的家庭名（展示核对用） */
  backupFamilyName: string | null;
}

/**
 * 计算恢复预览。
 * 家庭口径：备份家庭与当前家庭不一致时拒绝（避免把 A 家庭的数据
 * 写进 B 家庭视图）；当前无家庭（重装后云端尚未拉回）时按备份家庭落盘。
 */
export async function previewRestore(payload: BackupPayload): Promise<RestorePreview> {
  const current = useFamilyStore.getState().family;
  if (payload.family && current && payload.family.id !== current.id) {
    throw new Error(
      `备份属于家庭「${payload.family.name}」，与当前家庭不一致，请先切换到该家庭再恢复`,
    );
  }
  const familyId = current?.id ?? payload.family?.id;
  if (!familyId) throw new Error('尚未加入家庭，且备份中也没有家庭信息，无法恢复');

  const [assets, snapshots] = await Promise.all([
    assetRepository.list({ familyId, includeDeleted: true }),
    snapshotRepository.list({ familyId }),
  ]);
  return {
    plan: planRestore(payload, assets, snapshots),
    familyId,
    backupFamilyName: payload.family?.name ?? null,
  };
}

/**
 * 执行恢复：写本地仓储 + 逐条入队云端上行（其他设备随同步获得恢复的数据），
 * 最后重新 load 刷新 UI（load 内部会触发 syncNow）。
 */
export async function applyRestore(plan: RestorePlan, familyId: string): Promise<void> {
  for (const asset of plan.assetsToApply) {
    await assetRepository.upsert(asset);
    enqueueChange('asset', asset.id, 'upsert', asset);
  }
  for (const snapshot of plan.snapshotsToApply) {
    await snapshotRepository.append(snapshot);
    enqueueChange('asset_snapshots', snapshot.id, 'upsert', snapshot);
  }
  await useAssetStore.getState().load(familyId);
}
