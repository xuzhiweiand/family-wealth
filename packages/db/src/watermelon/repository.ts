/**
 * WatermelonDB 版 Repository 实现（ADR-0007）
 *
 * 把 W2 定义的 AssetRepository / SnapshotRepository 接口落到 WatermelonDB 上。
 * 懒加载：list/find 走 query.fetch()，不一次拉全表；observeAll 走 query.observe()
 * 的 RxJS Observable，桥接成 AsyncIterable 以对齐接口签名。
 *
 * ⚠️ 依赖 @nozbe/watermelondb（native 模块），本机沙箱无法安装，未纳入 typecheck。
 *    需在真机 prebuild 后验证（含 10 万快照懒加载 < 100ms，见 ADR-0007）。
 */

import { Database, Q } from '@nozbe/watermelondb';
import { AssetModel, AssetSnapshotModel } from './models';
import {
  toAsset,
  toAssetRecord,
  toSnapshot,
  toSnapshotRecord,
  type AssetRecord,
  type AssetSnapshotRecord,
} from '../mappers';
import type { AssetRepository, AssetFilter } from '../repository';
import type { SnapshotRepository, SnapshotFilter } from '../snapshots';
import type { Asset } from '@family-wealth/shared-types';

export class WatermelonAssetRepository implements AssetRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Asset | null> {
    const model = await this.db.get<AssetModel>('assets').find(id).catch(() => null);
    return model ? toAsset(model._raw as AssetRecord) : null;
  }

  async list(filter?: AssetFilter): Promise<Asset[]> {
    const models = await this.buildQuery(filter).fetch();
    return models.map((m) => toAsset(m._raw as AssetRecord));
  }

  async upsert(asset: Asset): Promise<void> {
    const record = toAssetRecord(asset);
    await this.db.write(async () => {
      const collection = this.db.get<AssetModel>('assets');
      const existing = await collection.find(asset.id).catch(() => null);
      if (existing) {
        await existing.update((m) => {
          m.familyId = record.family_id;
          m.ownerId = record.owner_id;
          m.type = record.type;
          m.name = record.name;
          m.currentAmount = record.current_amount;
          m.currency = record.currency;
          m.visibility = record.visibility;
          m.details = record.details;
          m.updatedAt = record.updated_at;
          if (record.deleted_at !== null) m.deletedAt = record.deleted_at;
        });
      } else {
        await collection.create((m) => {
          m._raw.id = record.id;
          m.familyId = record.family_id;
          m.ownerId = record.owner_id;
          m.type = record.type;
          m.name = record.name;
          m.currentAmount = record.current_amount;
          m.currency = record.currency;
          m.visibility = record.visibility;
          m.details = record.details;
          m.createdAt = record.created_at;
          m.updatedAt = record.updated_at;
          m.deletedAt = record.deleted_at;
        });
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.write(async () => {
      const model = await this.db.get<AssetModel>('assets').find(id).catch(() => null);
      if (model) {
        await model.update((m) => {
          m.deletedAt = Date.now();
        });
      }
    });
  }

  async *observeAll(filter?: AssetFilter): AsyncIterable<Asset[]> {
    const observable = this.buildQuery(filter).observe();
    const queue: Asset[][] = [];
    let done = false;
    let notify: (() => void) | null = null;

    const subscription = observable.subscribe({
      next: (models: AssetModel[]) => {
        queue.push(models.map((m) => toAsset(m._raw as AssetRecord)));
        notify?.();
      },
      error: () => {
        done = true;
        notify?.();
      },
    });

    try {
      while (true) {
        while (queue.length === 0 && !done) {
          await new Promise<void>((r) => {
            notify = r;
          });
        }
        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (done) {
          return;
        }
      }
    } finally {
      subscription.unsubscribe();
    }
  }

  private buildQuery(filter?: AssetFilter) {
    const query = this.db.get<AssetModel>('assets').query();
    if (!filter?.includeDeleted) {
      query.extend(Q.where('deleted_at', Q.eq(null)));
    }
    if (filter?.familyId) query.extend(Q.where('family_id', filter.familyId));
    if (filter?.type) query.extend(Q.where('type', filter.type));
    if (filter?.visibility) query.extend(Q.where('visibility', filter.visibility));
    return query;
  }
}

export class WatermelonSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: Database) {}

  async append(snapshot: Parameters<SnapshotRepository['append']>[0]): Promise<void> {
    const record = toSnapshotRecord(snapshot);
    await this.db.write(async () => {
      await this.db.get<AssetSnapshotModel>('asset_snapshots').create((m) => {
        m._raw.id = record.id;
        m.assetId = record.asset_id;
        m.familyId = record.family_id;
        m.amount = record.amount;
        m.currency = record.currency;
        m.capturedAt = record.captured_at;
        m.source = record.source;
      });
    });
  }

  async list(filter?: SnapshotFilter): Promise<ReturnType<SnapshotRepository['list']>> {
    const models = await this.buildQuery(filter).fetch();
    return models.map((m) => toSnapshot(m._raw as AssetSnapshotRecord));
  }

  async count(filter?: SnapshotFilter): Promise<number> {
    return this.buildQuery(filter).fetchCount();
  }

  private buildQuery(filter?: SnapshotFilter) {
    const query = this.db.get<AssetSnapshotModel>('asset_snapshots').query();
    if (filter?.familyId) query.extend(Q.where('family_id', filter.familyId));
    if (filter?.assetId) query.extend(Q.where('asset_id', filter.assetId));
    if (filter?.from) query.extend(Q.where('captured_at', Q.gte(new Date(filter.from).getTime())));
    if (filter?.to) query.extend(Q.where('captured_at', Q.lte(new Date(filter.to).getTime())));
    return query;
  }
}
