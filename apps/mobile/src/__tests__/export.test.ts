import type { Asset } from '@family-wealth/shared-types';
import { buildAssetsCsv, getAssetNote } from '../services/export';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'a1',
    familyId: 'f1',
    ownerId: 'u1',
    type: 'bank_deposit',
    name: '招商银行卡',
    currentAmount: 123456,
    currency: 'CNY',
    visibility: 'family',
    details: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-30T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('buildAssetsCsv', () => {
  it('以 UTF-8 BOM 开头，Excel 直接识别中文', () => {
    const csv = buildAssetsCsv([makeAsset()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('中文表头 + 金额按「元」保留两位小数', () => {
    const csv = buildAssetsCsv([makeAsset({ currentAmount: 123456 })]);
    const rows = csv.replace(/^﻿/, '').split('\r\n');
    expect(rows[0]).toBe('名称,类别,金额(元),币种,可见性,更新时间,备注');
    expect(rows[1]).toContain('招商银行卡,银行存款,1234.56,CNY,家庭,2026-09-30,');
  });

  it('私有资产标注「私密」', () => {
    const csv = buildAssetsCsv([makeAsset({ visibility: 'private' })]);
    expect(csv).toContain(',私密,');
  });

  it('包含逗号/引号/换行的字段按 CSV 规则转义', () => {
    const csv = buildAssetsCsv([
      makeAsset({ name: '家庭"备用金", 工行', details: { note: '第一行\n第二行' } }),
    ]);
    expect(csv).toContain('"家庭""备用金"", 工行"');
    expect(csv).toContain('"第一行\n第二行"');
  });

  it('空列表只输出表头', () => {
    const csv = buildAssetsCsv([]);
    const rows = csv.replace(/^﻿/, '').split('\r\n');
    expect(rows).toHaveLength(1);
  });

  it('负债金额原样输出（负值由上游语义决定）', () => {
    const csv = buildAssetsCsv([
      makeAsset({ type: 'debt', name: '房贷', currentAmount: -50000000 }),
    ]);
    expect(csv).toContain('房贷,债务,-500000.00');
  });
});

describe('getAssetNote', () => {
  it('details.note 为字符串时返回', () => {
    expect(getAssetNote(makeAsset({ details: { note: '工资卡' } }))).toBe('工资卡');
  });

  it('缺失或非字符串时返回空串', () => {
    expect(getAssetNote(makeAsset())).toBe('');
    expect(getAssetNote(makeAsset({ details: { note: 42 } }))).toBe('');
  });
});
