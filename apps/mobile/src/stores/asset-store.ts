/**
 * 资产与快照状态
 *
 * 约定：任何金额变更都同时写一条快照（数据模型 §C6），
 * 趋势图只认快照、不认 currentAmount —— 所以要改钱必须走 addAsset/updateAmount。
 */

import { create } from 'zustand';
import type { Asset, AssetSnapshot, AssetType } from '@family-wealth/shared-types';
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
  removeAsset: (assetId: string) => Promise<void>;
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
      visibility: 'family',
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
}));
