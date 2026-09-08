import type { Asset } from '@family-wealth/shared-types';
import { InMemoryAssetRepository, InMemorySnapshotRepository } from '../index';

const sampleAsset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset-1',
  familyId: 'fam-1',
  ownerId: 'user-1',
  type: 'cash',
  name: '工商银行卡',
  currentAmount: 50_000_00,
  currency: 'CNY',
  visibility: 'family',
  details: {},
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  deletedAt: null,
  ...overrides,
});

describe('InMemoryAssetRepository', () => {
  it('upserts and reads back', async () => {
    const repo = new InMemoryAssetRepository();
    const a = sampleAsset();
    await repo.upsert(a);
    expect(await repo.findById(a.id)).toEqual(a);
  });

  it('returns null for unknown id', async () => {
    const repo = new InMemoryAssetRepository();
    expect(await repo.findById('nope')).toBeNull();
  });

  it('filters by familyId', async () => {
    const repo = new InMemoryAssetRepository();
    await repo.upsert(sampleAsset({ id: 'a1', familyId: 'fam-1' }));
    await repo.upsert(sampleAsset({ id: 'a2', familyId: 'fam-2' }));
    const list = await repo.list({ familyId: 'fam-1' });
    expect(list.map((a) => a.id)).toEqual(['a1']);
  });

  it('filters by type', async () => {
    const repo = new InMemoryAssetRepository();
    await repo.upsert(sampleAsset({ id: 'a1', type: 'cash' }));
    await repo.upsert(sampleAsset({ id: 'a2', type: 'stock' }));
    const list = await repo.list({ type: 'stock' });
    expect(list.map((a) => a.id)).toEqual(['a2']);
  });

  it('soft-deletes (sets deletedAt)', async () => {
    const repo = new InMemoryAssetRepository();
    await repo.upsert(sampleAsset());
    await repo.delete('asset-1');
    const a = await repo.findById('asset-1');
    expect(a?.deletedAt).not.toBeNull();
    const list = await repo.list();
    expect(list).toEqual([]); // 默认过滤已删
  });

  it('includes deleted when filter says so', async () => {
    const repo = new InMemoryAssetRepository();
    await repo.upsert(sampleAsset());
    await repo.delete('asset-1');
    const list = await repo.list({ includeDeleted: true });
    expect(list).toHaveLength(1);
  });
});

describe('InMemorySnapshotRepository', () => {
  it('appends and counts', async () => {
    const repo = new InMemorySnapshotRepository();
    await repo.append({
      id: 's1', assetId: 'a1', familyId: 'f1', amount: 100, currency: 'CNY',
      capturedAt: '2026-09-01', source: 'manual',
    });
    expect(await repo.count()).toBe(1);
  });

  it('filters by familyId and date range', async () => {
    const repo = new InMemorySnapshotRepository();
    await repo.append({ id: 's1', assetId: 'a1', familyId: 'f1', amount: 100, currency: 'CNY', capturedAt: '2026-09-01', source: 'manual' });
    await repo.append({ id: 's2', assetId: 'a2', familyId: 'f2', amount: 200, currency: 'CNY', capturedAt: '2026-09-15', source: 'manual' });
    await repo.append({ id: 's3', assetId: 'a3', familyId: 'f1', amount: 300, currency: 'CNY', capturedAt: '2026-09-20', source: 'ocr' });
    const list = await repo.list({ familyId: 'f1', from: '2026-09-10', to: '2026-09-30' });
    expect(list.map((s) => s.id)).toEqual(['s3']);
  });
});

