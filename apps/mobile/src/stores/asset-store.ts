/**
 * 资产与快照状态
 *
 * 约定：任何金额变更都同时写一条快照（数据模型 §C6），
 * 趋势图只认快照、不认 currentAmount —— 所以要改钱必须走 addAsset/updateAmount。
 */

import { create } from 'zustand';
import type { Asset, AssetSnapshot, AssetType, Visibility } from '@family-wealth/shared-types';
import { assetRepository, snapshotRepository } from '../services/bootstrap';
import { enqueueChange, syncNow } from '../services/sync';
import { uuid as newId } from '../lib/uuid';

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
  /** 快照记账日期（ISO）；默认当前时间。补录历史余额时传用户选择的时间 */
  capturedAt?: string;
}

interface AssetState {
  assets: Asset[];
  snapshots: AssetSnapshot[];
  loading: boolean;
  error: string | null;

  load: (familyId: string) => Promise<void>;
  addAsset: (input: AddAssetInput) => Promise<Asset>;
  updateAmount: (assetId: string, amountInCents: number, familyId: string, source?: AssetSnapshot['source'], capturedAt?: string) => Promise<void>;
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
      // 云端：后台同步（推未决变更 + 拉远端），不阻塞当前渲染
      void syncNow(familyId);
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  async addAsset(input) {
    const now = new Date().toISOString();
    const asset: Asset = {
      id: newId(),
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
      id: newId(),
      assetId: asset.id,
      familyId: asset.familyId,
      amount: asset.currentAmount,
      currency: asset.currency,
      capturedAt: input.capturedAt ?? now,
      source: input.source,
    };

    await assetRepository.upsert(asset);
    await snapshotRepository.append(snapshot);

    // 云端入队并触发同步（无配置时 enqueue/sync 均 no-op）
    enqueueChange('asset', asset.id, 'upsert', asset);
    enqueueChange('asset_snapshots', snapshot.id, 'upsert', snapshot);
    void syncNow(asset.familyId);

    set({ assets: [...get().assets, asset], snapshots: [...get().snapshots, snapshot] });
    return asset;
  },

  async updateAmount(assetId, amountInCents, familyId, source = 'manual', capturedAt) {
    const existing = get().assets.find((a) => a.id === assetId);
    if (!existing) return;

    const now = new Date().toISOString();
    const updated: Asset = { ...existing, currentAmount: amountInCents, updatedAt: now };
    const snapshot: AssetSnapshot = {
      id: newId(),
      assetId,
      familyId,
      amount: amountInCents,
      currency: updated.currency,
      capturedAt: capturedAt ?? now,
      source,
    };

    await assetRepository.upsert(updated);
    await snapshotRepository.append(snapshot);

    enqueueChange('asset', assetId, 'upsert', updated);
    enqueueChange('asset_snapshots', snapshot.id, 'upsert', snapshot);
    void syncNow(familyId);

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
    // 软删按 delete 语义上行（远端行置 deleted_at；不重传明文）
    enqueueChange('asset', assetId, 'delete', removed);
    void syncNow(existing.familyId);
    // 注：块级函数体。单行箭头 + 三元在「set({ 单属性 })」语境下
    // 会触发 TS 5.7 解析器歧义（TS1005），块体可规避。
    set({
      assets: get().assets.map((a) => {
        return a.id === assetId ? removed : a;
      }),
    });
  },

  async updateAssetMeta(assetId, patch) {
    const existing = get().assets.find((a) => a.id === assetId);
    if (!existing) return;
    const now = new Date().toISOString();
    const updated: Asset = { ...existing, ...patch, updatedAt: now };
    await assetRepository.upsert(updated);
    enqueueChange('asset', assetId, 'upsert', updated);
    void syncNow(existing.familyId);
    set({
      assets: get().assets.map((a) => {
        return a.id === assetId ? updated : a;
      }),
    });
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
    enqueueChange('asset', assetId, 'upsert', restored);
    void syncNow(existing.familyId);
    set({
      assets: get().assets.map((a) => {
        return a.id === assetId ? restored : a;
      }),
    });
  },
}));
