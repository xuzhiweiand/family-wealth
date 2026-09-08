/**
 * 内存版资产仓库（开发兜底 + 单测 fixture）
 *
 * WatermelonDB 实现见 ./watermelon（ADR-0007）。本类在 mobile 未配置
 * 真实 DB 时兜底（见 bootstrap.ts），也让 jest 能脱离 native 模块直接测业务层。
 */

import type { Asset } from '@family-wealth/shared-types';
import type { AssetRepository, AssetFilter } from './repository';

export class InMemoryAssetRepository implements AssetRepository {
  private store = new Map<string, Asset>();
  private listeners = new Set<(snapshot: Asset[]) => void>();

  async findById(id: string): Promise<Asset | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: AssetFilter): Promise<Asset[]> {
    let result = Array.from(this.store.values());
    if (!filter?.includeDeleted) {
      result = result.filter((a) => a.deletedAt === null);
    }
    if (filter?.familyId) {
      result = result.filter((a) => a.familyId === filter.familyId);
    }
    if (filter?.type) {
      result = result.filter((a) => a.type === filter.type);
    }
    if (filter?.visibility) {
      result = result.filter((a) => a.visibility === filter.visibility);
    }
    return result;
  }

  async upsert(asset: Asset): Promise<void> {
    this.store.set(asset.id, asset);
    this.emit();
  }

  async delete(id: string): Promise<void> {
    const a = this.store.get(id);
    if (a) {
      this.store.set(id, { ...a, deletedAt: new Date().toISOString() });
      this.emit();
    }
  }

  async *observeAll(filter?: AssetFilter): AsyncIterable<Asset[]> {
    const queue: Asset[][] = [];
    let pending = false;
    const listener = (snap: Asset[]) => {
      queue.push(snap);
      pending = true;
    };
    this.listeners.add(listener);
    // 立即 yield 当前快照
    yield await this.list(filter);
    try {
      while (true) {
        if (!pending) {
          await new Promise((r) => setTimeout(r, 16));
          continue;
        }
        pending = false;
        yield await this.list(filter);
      }
    } finally {
      this.listeners.delete(listener);
    }
  }

  private emit(): void {
    const snap = Array.from(this.store.values());
    for (const l of this.listeners) l(snap);
  }
}