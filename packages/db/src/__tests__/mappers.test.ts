import {
  toAsset,
  toAssetRecord,
  toSnapshot,
  toSnapshotRecord,
  type AssetRecord,
  type AssetSnapshotRecord,
} from '../mappers';
import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';

const sampleAsset: Asset = {
  id: 'asset-1',
  familyId: 'fam-1',
  ownerId: 'user-1',
  type: 'cash',
  name: '工商银行卡',
  currentAmount: 50_000_00,
  currency: 'CNY',
  visibility: 'family',
  details: { bank: '工商银行', note: '活期' },
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-02T09:30:00.000Z',
  deletedAt: null,
};

describe('toAssetRecord / toAsset round-trip', () => {
  it('maps camelCase domain to snake_case record', () => {
    const rec = toAssetRecord(sampleAsset);
    expect(rec).toMatchObject({
      id: 'asset-1',
      family_id: 'fam-1',
      owner_id: 'user-1',
      type: 'cash',
      name: '工商银行卡',
      current_amount: 50_000_00,
      currency: 'CNY',
      visibility: 'family',
      created_at: Date.parse('2026-09-01T08:00:00.000Z'),
      updated_at: Date.parse('2026-09-02T09:30:00.000Z'),
      deleted_at: null,
    });
    // details 序列化为 JSON 字符串
    expect(JSON.parse(rec.details)).toEqual({ bank: '工商银行', note: '活期' });
  });

  it('round-trips asset unchanged', () => {
    const rec = toAssetRecord(sampleAsset);
    expect(toAsset(rec)).toEqual(sampleAsset);
  });

  it('maps record back to domain with parsed details and ISO dates', () => {
    const rec: AssetRecord = {
      id: 'asset-1',
      family_id: 'fam-1',
      owner_id: 'user-1',
      type: 'stock',
      name: '腾讯控股',
      current_amount: 123456,
      currency: 'CNY',
      visibility: 'private',
      details: JSON.stringify({ code: '00700', shares: 100 }),
      created_at: Date.parse('2026-09-01T00:00:00.000Z'),
      updated_at: Date.parse('2026-09-02T00:00:00.000Z'),
      deleted_at: Date.parse('2026-09-03T00:00:00.000Z'),
    };
    const asset = toAsset(rec);
    expect(asset.details).toEqual({ code: '00700', shares: 100 });
    expect(asset.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(asset.deletedAt).toBe('2026-09-03T00:00:00.000Z');
    expect(asset.type).toBe('stock');
    expect(asset.visibility).toBe('private');
  });

  it('handles null/empty details defensively', () => {
    const rec = toAssetRecord(sampleAsset);
    const broken = { ...rec, details: '' };
    expect(toAsset(broken).details).toEqual({});
    const nullish = { ...rec, details: null as unknown as string };
    expect(toAsset(nullish).details).toEqual({});
    const malformed = { ...rec, details: 'not-json' };
    expect(toAsset(malformed).details).toEqual({});
  });

  it('preserves deletedAt null', () => {
    const rec = toAssetRecord(sampleAsset);
    expect(rec.deleted_at).toBeNull();
    expect(toAsset(rec).deletedAt).toBeNull();
  });
});

describe('toSnapshotRecord / toSnapshot round-trip', () => {
  const sampleSnapshot: AssetSnapshot = {
    id: 'snap-1',
    assetId: 'asset-1',
    familyId: 'fam-1',
    amount: 50_000_00,
    currency: 'CNY',
    capturedAt: '2026-09-01T08:00:00.000Z',
    source: 'manual',
  };

  it('maps snapshot to record', () => {
    const rec = toSnapshotRecord(sampleSnapshot);
    expect(rec).toEqual({
      id: 'snap-1',
      asset_id: 'asset-1',
      family_id: 'fam-1',
      amount: 50_000_00,
      currency: 'CNY',
      captured_at: Date.parse('2026-09-01T08:00:00.000Z'),
      source: 'manual',
    });
  });

  it('round-trips snapshot unchanged', () => {
    expect(toSnapshot(toSnapshotRecord(sampleSnapshot))).toEqual(sampleSnapshot);
  });

  it('maps record back to domain (source typed)', () => {
    const rec: AssetSnapshotRecord = {
      id: 'snap-2',
      asset_id: 'a2',
      family_id: 'f2',
      amount: 123,
      currency: 'CNY',
      captured_at: Date.parse('2026-09-02T00:00:00.000Z'),
      source: 'ocr',
    };
    expect(toSnapshot(rec)).toEqual({
      id: 'snap-2',
      assetId: 'a2',
      familyId: 'f2',
      amount: 123,
      currency: 'CNY',
      capturedAt: '2026-09-02T00:00:00.000Z',
      source: 'ocr',
    });
  });
});
