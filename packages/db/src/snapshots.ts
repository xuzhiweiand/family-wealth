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
}