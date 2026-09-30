/**
 * 数据导出（技术方案 §14 / 需求 P0-3）
 *
 * 当前实现：资产清单 CSV（UTF-8 + BOM，Excel 直接识别中文）。
 * 流程：本机拼 CSV → file-export.ts 统一通道（Android 系统分享 / 鸿蒙系统另存为）。
 *
 * 金额在 CSV 里用「元」（除以 100），对用户更直观；
 * 备注从 details.note 读取（P1，复用 details 口袋，无需类型迁移）。
 *
 * 可见性口径：调用方必须传入 filterVisibleAssets 过滤后的资产列表，
 * 保证私有资产不进入他人视角的导出文件（验收标准 2）。
 */

import type { Asset } from '@family-wealth/shared-types';
import { ASSET_TYPE_LABELS } from '../lib/asset-meta';
import { exportFile, type FileExportResult } from './file-export';

function csvCell(raw: string): string {
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

/** 从 details 口袋取备注 */
export function getAssetNote(asset: Asset): string {
  const note = asset.details?.['note'];
  return typeof note === 'string' ? note : '';
}

export function buildAssetsCsv(assets: readonly Asset[]): string {
  const header = ['名称', '类别', '金额(元)', '币种', '可见性', '更新时间', '备注'];
  const lines = assets.map((a) => [
    a.name,
    ASSET_TYPE_LABELS[a.type],
    (a.currentAmount / 100).toFixed(2),
    a.currency,
    a.visibility === 'private' ? '私密' : '家庭',
    a.updatedAt.slice(0, 10),
    getAssetNote(a),
  ]);
  return `﻿${[header, ...lines].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

export type ExportResult = FileExportResult;

/**
 * 导出资产 CSV。
 * @param assets 必须是「当前用户可见」口径（filterVisibleAssets 过滤后）
 * @param exportedAt 用于文件命名（YYYY-MM-DD），默认今天
 */
export async function exportAssetsCsv(
  assets: readonly Asset[],
  exportedAt: string = new Date().toISOString().slice(0, 10),
): Promise<ExportResult> {
  const csv = buildAssetsCsv(assets);
  return exportFile(`家庭资产报表-${exportedAt}.csv`, csv, 'text/csv');
}
