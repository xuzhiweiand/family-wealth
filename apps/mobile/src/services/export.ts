/**
 * 数据导出（技术方案 §14 / 需求 P0）
 *
 * 当前实现：资产清单 CSV（UTF-8 + BOM，Excel 直接识别中文）。
 * 流程：本机拼 CSV → expo-file-system 落盘 → expo-sharing 调系统分享/存储。
 * 分享不可用（Web / 模拟器无分享组件）时返回文件路径，由调用方提示。
 *
 * 金额在 CSV 里用「元」（除以 100），对用户更直观；
 * 备注从 details.note 读取（P1，复用 details 口袋，无需类型迁移）。
 */

import type { Asset } from '@family-wealth/shared-types';
import { ASSET_TYPE_LABELS } from '../lib/asset-meta';

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

export interface ExportResult {
  uri: string;
  /** 是否已成功调起系统分享 */
  shared: boolean;
}

/**
 * 导出并调起分享。
 * @param exportedAt 用于文件命名（YYYY-MM-DD），默认今天
 */
export async function exportAssetsCsv(
  assets: readonly Asset[],
  exportedAt: string = new Date().toISOString().slice(0, 10),
): Promise<ExportResult> {
  const csv = buildAssetsCsv(assets);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FileSystem = require('expo-file-system') as {
    documentDirectory: string;
    writeAsStringAsync: (uri: string, content: string, options?: { encoding?: string }) => Promise<void>;
    EncodingType: { UTF8: string };
  };

  const uri = `${FileSystem.documentDirectory}家庭资产报表-${exportedAt}.csv`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sharing = require('expo-sharing') as {
      isAvailableAsync: () => Promise<boolean>;
      shareAsync: (uri: string, options?: Record<string, unknown>) => Promise<void>;
    };
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        dialogTitle: '导出家庭资产报表',
      });
      return { uri, shared: true };
    }
  } catch {
    // 分享模块缺失或用户取消——落到文件路径提示
  }
  return { uri, shared: false };
}
