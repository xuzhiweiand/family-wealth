import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';
import { deriveUMK, toBase64, generateSalt } from '@family-wealth/crypto';
import {
  packBackup,
  serializeBackupFile,
  parseBackupFile,
  unpackBackup,
  planRestore,
  BACKUP_FORMAT_VERSION,
  type BackupPayload,
} from '../lib/backup';

const PASSWORD = 'test-password-123';
const salt = generateSalt();
// 全程复用同一 UMK，避免每个用例都跑 PBKDF2 100k（纯 JS 较慢）
const umk = deriveUMK(PASSWORD, salt);
const saltBase64 = toBase64(salt);

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

function makeSnapshot(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: 's1',
    assetId: 'a1',
    familyId: 'f1',
    amount: 123456,
    currency: 'CNY',
    capturedAt: '2026-09-01T00:00:00.000Z',
    source: 'manual',
    ...overrides,
  };
}

function makePayload(): BackupPayload {
  return {
    family: {
      id: 'f1',
      name: '三口之家',
      ownerId: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastRotatedAt: null,
    },
    members: [
      { userId: 'u1', displayName: '爸爸', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
    ],
    assets: [makeAsset(), makeAsset({ id: 'a2', name: '房贷', currentAmount: -80000000 })],
    snapshots: [makeSnapshot(), makeSnapshot({ id: 's2', amount: 100000 })],
  };
}

describe('备份打包/解包', () => {
  it('往返一致：pack → serialize → parse → unpack 还原全部明文', async () => {
    const payload = makePayload();
    const file = packBackup(payload, umk, saltBase64, new Date('2026-09-30T12:00:00.000Z'));

    expect(file.kind).toBe('family-wealth-backup');
    expect(file.version).toBe(BACKUP_FORMAT_VERSION);
    expect(file.createdAt).toBe('2026-09-30T12:00:00.000Z');
    expect(file.kdf.salt).toBe(saltBase64);

    const parsed = parseBackupFile(serializeBackupFile(file));
    const restored = await unpackBackup(parsed, PASSWORD);
    expect(restored).toEqual(payload);
  });

  it('密文不含明文线索（资产名称不出现在备份文件中）', () => {
    const file = packBackup(makePayload(), umk, saltBase64);
    const raw = serializeBackupFile(file);
    expect(raw).not.toContain('招商银行卡');
    expect(raw).not.toContain('三口之家');
  });

  it('密码错误 → 明确报错', async () => {
    const file = packBackup(makePayload(), umk, saltBase64);
    await expect(unpackBackup(file, 'wrong-password')).rejects.toThrow(
      '密码不正确，或备份文件已被篡改',
    );
  });

  it('篡改密文 → 明确报错（GCM 认证失败）', async () => {
    const file = packBackup(makePayload(), umk, saltBase64);
    const tampered = {
      ...file,
      payload: { ...file.payload, ciphertext: file.payload.ciphertext.replace(/^../, 'AA') },
    };
    await expect(unpackBackup(tampered, PASSWORD)).rejects.toThrow(
      '密码不正确，或备份文件已被篡改',
    );
  });

  it('解包用的是包内 salt：与「当前设备 salt」无关', async () => {
    // 模拟改密码前的旧备份：包内 salt 是历史值，照样能凭旧密码解开
    const oldSalt = generateSalt();
    const oldUmk = deriveUMK('old-password', oldSalt);
    const file = packBackup(makePayload(), oldUmk, toBase64(oldSalt));
    const restored = await unpackBackup(file, 'old-password');
    expect(restored.assets).toHaveLength(2);
  });
});

describe('备份文件校验', () => {
  it('非 JSON → 损坏提示', () => {
    expect(() => parseBackupFile('not-json{')).toThrow('备份文件已损坏');
  });

  it('非备份文件（kind 不符）→ 提示重新选择', () => {
    expect(() => parseBackupFile(JSON.stringify({ kind: 'something-else' }))).toThrow(
      '这不是家资备份文件',
    );
  });

  it('版本过新 → 提示升级 App', () => {
    const file = packBackup(makePayload(), umk, saltBase64);
    const newer = { ...file, version: BACKUP_FORMAT_VERSION + 1 };
    expect(() => parseBackupFile(JSON.stringify(newer))).toThrow('请升级后再恢复');
  });

  it('缺 kdf → 损坏提示', () => {
    const file = packBackup(makePayload(), umk, saltBase64) as unknown as Record<string, unknown>;
    delete file['kdf'];
    expect(() => parseBackupFile(JSON.stringify(file))).toThrow('密钥信息不完整');
  });

  it('缺加密数据 → 损坏提示', () => {
    const file = packBackup(makePayload(), umk, saltBase64) as unknown as Record<string, unknown>;
    delete file['payload'];
    expect(() => parseBackupFile(JSON.stringify(file))).toThrow('加密数据不完整');
  });
});

describe('恢复合并计划（仅合并）', () => {
  it('本地为空 → 全部计为新增', () => {
    const plan = planRestore(makePayload(), [], []);
    expect(plan.counts.assets).toEqual({ added: 2, updated: 0, unchanged: 0 });
    expect(plan.counts.snapshots).toEqual({ added: 2, existing: 0 });
    expect(plan.assetsToApply).toHaveLength(2);
    expect(plan.snapshotsToApply).toHaveLength(2);
  });

  it('同 id 且备份 updatedAt 较新 → 计为更新；较旧/相等 → 不动', () => {
    const payload: BackupPayload = {
      ...makePayload(),
      assets: [
        makeAsset({ id: 'a1', updatedAt: '2026-09-30T10:00:00.000Z' }), // 较新 → 更新
        makeAsset({ id: 'a2', updatedAt: '2026-09-01T00:00:00.000Z' }), // 较旧 → 不动
      ],
      snapshots: [],
    };
    const current = [
      makeAsset({ id: 'a1', updatedAt: '2026-09-30T08:00:00.000Z' }),
      makeAsset({ id: 'a2', updatedAt: '2026-09-30T08:00:00.000Z' }),
    ];
    const plan = planRestore(payload, current, []);
    expect(plan.counts.assets).toEqual({ added: 0, updated: 1, unchanged: 1 });
    expect(plan.assetsToApply.map((a) => a.id)).toEqual(['a1']);
  });

  it('快照按 id 并集去重，已存在的不重复写入', () => {
    const plan = planRestore(makePayload(), [], [makeSnapshot({ id: 's1' })]);
    expect(plan.counts.snapshots).toEqual({ added: 1, existing: 1 });
    expect(plan.snapshotsToApply.map((s) => s.id)).toEqual(['s2']);
  });

  it('软删除资产也参与合并（完整迁移口径）', () => {
    const payload: BackupPayload = {
      ...makePayload(),
      assets: [makeAsset({ id: 'a9', deletedAt: '2026-09-15T00:00:00.000Z' })],
    };
    const plan = planRestore(payload, [], []);
    expect(plan.counts.assets.added).toBe(1);
    expect(plan.assetsToApply[0]!.deletedAt).not.toBeNull();
  });
});
