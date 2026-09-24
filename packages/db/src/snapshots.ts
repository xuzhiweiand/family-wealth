/**
 * 资产快照仓库（趋势图唯一数据源）
 */

import type { AssetSnapshot } from '@family-wealth/shared-types';

export interface SnapshotFilter {
  familyId?: string;
  assetId?: string;
  from?: string;
  to?: string;
}

export interface SnapshotRepository {
  append(snapshot: AssetSnapshot): Promise<void>;
  list(filter?: SnapshotFilter): Promise<AssetSnapshot[]>;
  count(filter?: SnapshotFilter): Promise<number>;
  /** 物理移除（快照被用户删除后调用；云端以墓碑同步，见 packages/sync） */
  remove(id: string): Promise<void>;
}

export class InMemorySnapshotRepository implements SnapshotRepository {
  private store: AssetSnapshot[] = [];

  async append(snapshot: AssetSnapshot): Promise<void> {
    this.store.push(snapshot);
  }

  async list(filter?: SnapshotFilter): Promise<AssetSnapshot[]> {
    let result = this.store;
    if (filter?.familyId) result = result.filter((s) => s.familyId === filter.familyId);
    if (filter?.assetId) result = result.filter((s) => s.assetId === filter.assetId);
    if (filter?.from) result = result.filter((s) => s.capturedAt >= filter.from!);
    if (filter?.to) result = result.filter((s) => s.capturedAt <= filter.to!);
    return result.slice();
  }

  async count(filter?: SnapshotFilter): Promise<number> {
    return (await this.list(filter)).length;
  }

  async remove(id: string): Promise<void> {
    this.store = this.store.filter((s) => s.id !== id);
  }
}