/**
 * 资产与快照状态
 *
 * 约定：任何金额变更都同时写一条快照（数据模型 §C6），
 * 趋势图只认快照、不认 currentAmount —— 所以要改钱必须走 addAsset/updateAmount。
 */

import { create } from 'zustand';
import type { Asset, AssetSnapshot, AssetType, Visibility } from '@family-wealth/shared-types';
import { assetRepository, snapshotRepository } from '../services/bootstrap';

/** 本地 id：真机上可换成 uuid 库，这里避免引入 native 依赖 */
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface AddAssetInput {
  familyId: string;
  ownerId: string;
  type: AssetType;
  name: string;
  /** 单位「分」 */
  amountInCents: number;
  source: AssetSnapshot['source'];
  /** 默认 'family'（家庭共享）；owner/editor 可选 'private'（仅创建者本人与 owner 可见） */
  visibility?: Visibility;
  details?: Record<string, unknown>;
}

interface AssetState {
  assets: Asset[];
  snapshots: AssetSnapshot[];
  loading: boolean;
  error: string | null;

  load: (familyId: string) => Promise<void>;
  addAsset: (input: AddAssetInput) => Promise<Asset>;
  updateAmount: (assetId: string, amountInCents: number, familyId: string, source?: AssetSnapshot['source']) => Promise<void>;
  /** 改资产元数据（名称/类型/可见性/details）。金额变更请走 updateAmount 以触发快照 */
  updateAssetMeta: (assetId: string, patch: Partial<Pick<Asset, 'name' | 'type' | 'visibility' | 'details'>>) => Promise<void>;
  removeAsset: (assetId: string) => Promise<void>;
  /** 软删恢复：把 deletedAt 改回 null，不写新快照（曲线按 carry-forward 延续） */
  restoreAsset: (assetId: string) => Promise<void>;
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: [],
  snapshots: [],
  loading: false,
  error: null,

  async load(familyId) {
    set({ loading: true, error: null });
    try {
      const [assets, snapshots] = await Promise.all([
        assetRepository.list({ familyId }),
        snapshotRepository.list({ familyId }),
      ]);
      set({ assets, snapshots, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  async addAsset(input) {
    const now = new Date().toISOString();
    const asset: Asset = {
      id: newId('a'),
      familyId: input.familyId,
      ownerId: input.ownerId,
      type: input.type,
      name: input.name,
      currentAmount: input.amountInCents,
      currency: 'CNY',
      visibility: input.visibility ?? 'family',
      details: input.details ?? {},
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const snapshot: AssetSnapshot = {
      id: newId('s'),
      assetId: asset.id,
      familyId: asset.familyId,
      amount: asset.currentAmount,
      currency: asset.currency,
      capturedAt: now,
      source: input.source,
    };

    await assetRepository.upsert(asset);
    await snapshotRepository.append(snapshot);

    set({ assets: [...get().assets, asset], snapshots: [...get().snapshots, snapshot] });
    return asset;
  },

  async updateAmount(assetId, amountInCents, familyId, source = 'manual') {
    const existing = get().assets.find((a) => a.id === assetId);
    if (!existing) return;

    const now = new Date().toISOString();
    const updated: Asset = { ...existing, currentAmount: amountInCents, updatedAt: now };
    const snapshot: AssetSnapshot = {
      id: newId('s'),
      assetId,
      familyId,
      amount: amountInCents,
      currency: updated.currency,
      capturedAt: now,
      source,
    };

    await assetRepository.upsert(updated);
    await snapshotRepository.append(snapshot);

    set({
      assets: get().assets.map((a) => (a.id === assetId ? updated : a)),
      snapshots: [...get().snapshots, snapshot],
    });
  },

  async removeAsset(assetId) {
    // 软删：财务数据不物理删除（数据模型 §C7）
    const existing = get().assets.find((a) => a.id === assetId);
    if (!existing) return;
    const now = new Date().toISOString();
    const removed: Asset = { ...existing, deletedAt: now, updatedAt: now };
    await assetRepository.upsert(removed);
    set({ assets: get().assets.map((a) => (a.id === assetId ? removed : a)) });
  },

  async updateAssetMeta(assetId, patch) {
    const existing = get().assets.find((a) => a.id === assetId);
    if (!existing) return;
    const now = new Date().toISOString();
    const updated: Asset = { ...existing, ...patch, updatedAt: now };
    await assetRepository.upsert(updated);
    set({ assets: get().assets.map((a) => (a.id === assetId ? updated : a)) });
  },

  async restoreAsset(assetId) {
    // 恢复：把 deletedAt 改回 null。故意不写快照——删除期间的快照历史还在，
    // 资产恢复后由 carry-forward 基线把曲线接回原值，不会在图上画出假的"暴涨"
    const existing = get().assets.find((a) => a.id === assetId);
    if (!existing) return;
    if (existing.deletedAt === null) return; // 已经在 active，无需操作
    const now = new Date().toISOString();
    const restored: Asset = { ...existing, deletedAt: null, updatedAt: now };
    await assetRepository.upsert(restored);
    set({ assets: get().assets.map((a) => (a.id === assetId ? restored : a)) });
  },
}));
