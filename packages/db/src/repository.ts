/**
 * 资产仓库接口
 *
 * 设计：W2 提供 InMemoryAssetRepository（mock，便于单测）
 *      W3 接入 WatermelonDB 实现（ADR-0007）
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