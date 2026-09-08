/**
 * 资产仓库接口
 *
 * 实现：InMemoryAssetRepository（开发兜底/单测）+ WatermelonDB 实现（ADR-0007，真机）。
 * 业务层只依赖本接口，不感知底层是内存还是 SQLite。
 */

import type { Asset } from '@family-wealth/shared-types';

export interface AssetFilter {
  familyId?: string;
  type?: Asset['type'];
  visibility?: Asset['visibility'];
  includeDeleted?: boolean;
}

export interface AssetRepository {
  findById(id: string): Promise<Asset | null>;
  list(filter?: AssetFilter): Promise<Asset[]>;
  upsert(asset: Asset): Promise<void>;
  delete(id: string): Promise<void>; // 软删（写 deletedAt）
  observeAll(filter?: AssetFilter): AsyncIterable<Asset[]>; // 简化版 observe
}