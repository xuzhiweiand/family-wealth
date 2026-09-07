import { generateRandomBytes } from '@family-wealth/crypto';
import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';
import { SyncEngine, type SyncEngineDeps } from '../engine';
import type {
  AssetPort,
  PushAck,
  QueuePort,
  RemoteAdapter,
  RemoteRow,
  SnapshotPort,
  SyncKind,
  SyncQueueEntry,
} from '../types';

const FDK = generateRandomBytes(32);
const FAMILY = 'family-1';

function makeAsset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id,
    familyId: FAMILY,
    ownerId: 'u1',
    type: 'bank_deposit',
    name: `asset-${id}`,
    currentAmount: 100_00,
    currency: 'CNY',
    visibility: 'family',
    details: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

function makeSnapshot(id: string, assetId: string): AssetSnapshot {
  return {
    id,
    assetId,
    familyId: FAMILY,
    amount: 100_00,
    currency: 'CNY',
    capturedAt: '2026-09-07T00:00:00.000Z',
    source: 'ocr',
  };
}

class MemoryRemote implements RemoteAdapter {
  rows: RemoteRow[] = [];
  pushed: RemoteRow[] = [];
  lastSince: string | null | undefined = undefined;
  failPush = false;

  async pull(since: string | null, kinds: readonly SyncKind[]): Promise<RemoteRow[]> {
    this.lastSince = since;
    return this.rows.filter((r) => (since === null || r.updatedAt > since) && kinds.includes(r.kind));
  }

  async push(rows: readonly RemoteRow[]): Promise<PushAck[]> {
    if (this.failPush) return rows.map((r) => ({ id: r.id, ok: false, error: 'network down' }));
    this.pushed.push(...rows);
    return rows.map((r) => ({ id: r.id, ok: true }));
  }
}

class MemoryAssets implements AssetPort {
  store = new Map<string, Asset>();
  async findById(id: string): Promise<Asset | null> {
    return this.store.get(id) ?? null;
  }
  async upsert(asset: Asset): Promise<void> {
    this.store.set(asset.id, asset);
  }
}

class MemorySnapshots implements SnapshotPort {
  store = new Map<string, AssetSnapshot>();
  async has(id: string): Promise<boolean> {
    return this.store.has(id);
  }
  async append(s: AssetSnapshot): Promise<void> {
    this.store.set(s.id, s);
  }
}

class MemoryQueue implements QueuePort {
  entries: SyncQueueEntry[] = [];
  done: string[] = [];
  failed: string[] = [];

  enqueue(entry: Omit<SyncQueueEntry, 'id' | 'retries'>): void {
    this.entries.push({ id: `q${this.entries.length + 1}`, retries: 0, ...entry });
  }

  pending(): SyncQueueEntry[] {
    return this.entries.slice();
  }

  markDone(id: string): void {
    this.done.push(id);
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  markFailed(id: string): void {
    this.failed.push(id);
    const e = this.entries.find((x) => x.id === id);
    if (e) e.retries += 1;
  }
}

/** 用与引擎相同的编解码方式手工造一行远端密文 */
function remoteRowOf(payload: unknown, opts: { id: string; kind?: SyncKind; updatedAt: string; deletedAt?: string | null }): RemoteRow {
  const { buildAad, encodeRecord } = jest.requireActual('../codec') as typeof import('../codec');
  return {
    id: opts.id,
    kind: opts.kind ?? 'asset',
    updatedAt: opts.updatedAt,
    deletedAt: opts.deletedAt ?? null,
    envelope: encodeRecord(payload, FDK, buildAad(FAMILY)),
  };
}

function setup(over: Partial<SyncEngineDeps> = {}) {
  const remote = new MemoryRemote();
  const assets = new MemoryAssets();
  const snapshots = new MemorySnapshots();
  const queue = new MemoryQueue();
  const engine = new SyncEngine({ remote, assets, snapshots, queue, fdk: FDK, familyId: FAMILY, ...over });
  return { engine, remote, assets, snapshots, queue };
}

describe('SyncEngine.pull', () => {
  it('does nothing when the remote is empty', async () => {
    const { engine, remote } = setup();
    const stats = await engine.pull();
    expect(stats).toEqual({ pulled: 0, applied: 0, conflicts: 0, failed: 0 });
    expect(remote.lastSince).toBeNull();
  });

  it('applies a brand-new remote asset', async () => {
    const { engine, remote, assets } = setup();
    remote.rows = [remoteRowOf(makeAsset('a1', { currentAmount: 500_00 }), { id: 'a1', updatedAt: '2026-09-07T10:00:00.000Z' })];
    const stats = await engine.pull();
    expect(stats.applied).toBe(1);
    expect(assets.store.get('a1')?.currentAmount).toBe(500_00);
  });

  it('advances the cursor to the newest row', async () => {
    const { engine, remote } = setup();
    remote.rows = [
      remoteRowOf(makeAsset('a1'), { id: 'a1', updatedAt: '2026-09-07T10:00:00.000Z' }),
      remoteRowOf(makeAsset('a2'), { id: 'a2', updatedAt: '2026-09-08T10:00:00.000Z' }),
    ];
    await engine.pull();
    expect(engine.getCursor()).toBe('2026-09-08T10:00:00.000Z');
    await engine.pull();
    expect(remote.lastSince).toBe('2026-09-08T10:00:00.000Z');
  });

  it('overwrites local when the remote is newer', async () => {
    const { engine, remote, assets } = setup();
    assets.store.set('a1', makeAsset('a1', { currentAmount: 1, updatedAt: '2026-09-07T09:00:00.000Z' }));
    remote.rows = [remoteRowOf(makeAsset('a1', { currentAmount: 2 }), { id: 'a1', updatedAt: '2026-09-07T12:00:00.000Z' })];
    const stats = await engine.pull();
    expect(stats.applied).toBe(1);
    expect(assets.store.get('a1')?.currentAmount).toBe(2);
  });

  it('keeps local when local is newer (conflict)', async () => {
    const { engine, remote, assets } = setup();
    assets.store.set('a1', makeAsset('a1', { currentAmount: 1, updatedAt: '2026-09-07T12:00:00.000Z' }));
    remote.rows = [remoteRowOf(makeAsset('a1', { currentAmount: 2 }), { id: 'a1', updatedAt: '2026-09-07T09:00:00.000Z' })];
    const stats = await engine.pull();
    expect(stats.conflicts).toBe(1);
    expect(stats.applied).toBe(0);
    expect(assets.store.get('a1')?.currentAmount).toBe(1);
  });

  it('applies a remote soft delete', async () => {
    const { engine, remote, assets } = setup();
    assets.store.set('a1', makeAsset('a1', { updatedAt: '2026-09-07T09:00:00.000Z' }));
    remote.rows = [
      remoteRowOf(makeAsset('a1'), { id: 'a1', updatedAt: '2026-09-07T08:00:00.000Z', deletedAt: '2026-09-07T08:00:00.000Z' }),
    ];
    const stats = await engine.pull();
    expect(stats.applied).toBe(1);
    expect(assets.store.get('a1')?.deletedAt).toBe('2026-09-07T08:00:00.000Z');
  });

  it('counts undecryptable rows as failed without aborting the batch', async () => {
    const { engine, remote, assets } = setup();
    remote.rows = [
      { id: 'bad', kind: 'asset', updatedAt: '2026-09-07T10:00:00.000Z', deletedAt: null, envelope: 'garbage' },
      remoteRowOf(makeAsset('a1'), { id: 'a1', updatedAt: '2026-09-07T11:00:00.000Z' }),
    ];
    const stats = await engine.pull();
    expect(stats.failed).toBe(1);
    expect(stats.applied).toBe(1);
    expect(assets.store.has('a1')).toBe(true);
  });

  it('fails to decrypt rows encrypted with another key', async () => {
    const { engine, remote } = setup();
    const { buildAad, encodeRecord } = jest.requireActual('../codec') as typeof import('../codec');
    remote.rows = [
      {
        id: 'a1',
        kind: 'asset' as const,
        updatedAt: '2026-09-07T10:00:00.000Z',
        deletedAt: null,
        envelope: encodeRecord(makeAsset('a1'), generateRandomBytes(32), buildAad(FAMILY)),
      },
    ];
    const stats = await engine.pull();
    expect(stats.failed).toBe(1);
  });

  it('appends snapshots exactly once (append-only 幂等)', async () => {
    const { engine, remote, snapshots } = setup();
    const snap = makeSnapshot('s1', 'a1');
    remote.rows = [remoteRowOf(snap, { id: 's1', kind: 'snapshot', updatedAt: '2026-09-07T10:00:00.000Z' })];
    await engine.pull();
    remote.rows = [remoteRowOf(snap, { id: 's1', kind: 'snapshot', updatedAt: '2026-09-07T10:00:00.000Z' })];
    await engine.pull(['snapshot']);
    expect(snapshots.store.size).toBe(1);
  });

  it('can pull only the requested kinds', async () => {
    const { engine, remote } = setup();
    remote.rows = [
      remoteRowOf(makeAsset('a1'), { id: 'a1', updatedAt: '2026-09-07T10:00:00.000Z' }),
      remoteRowOf(makeSnapshot('s1', 'a1'), { id: 's1', kind: 'snapshot', updatedAt: '2026-09-07T10:00:00.000Z' }),
    ];
    const stats = await engine.pull(['asset']);
    expect(stats.pulled).toBe(1);
  });
});

describe('SyncEngine.push', () => {
  it('does nothing when the queue is empty', async () => {
    const { engine, remote } = setup();
    const stats = await engine.push();
    expect(stats).toEqual({ pushed: 0, failed: 0 });
    expect(remote.pushed).toEqual([]);
  });

  it('encrypts and pushes pending upserts, then clears the queue', async () => {
    const { engine, remote, queue } = setup();
    queue.enqueue({
      table: 'assets',
      recordId: 'a1',
      op: 'upsert',
      payload: makeAsset('a1', { currentAmount: 999_00 }),
      createdAt: '2026-09-07T10:00:00.000Z',
    });
    const stats = await engine.push();
    expect(stats.pushed).toBe(1);
    expect(remote.pushed).toHaveLength(1);
    expect(remote.pushed[0]!.id).toBe('a1');
    expect(remote.pushed[0]!.kind).toBe('asset');
    expect(remote.pushed[0]!.envelope).not.toContain('999');
    expect(queue.done).toHaveLength(1);
    expect(queue.entries).toHaveLength(0);
  });

  it('uses the payload updatedAt as the row timestamp', async () => {
    const { engine, remote, queue } = setup();
    queue.enqueue({
      table: 'assets',
      recordId: 'a1',
      op: 'upsert',
      payload: makeAsset('a1', { updatedAt: '2026-09-07T08:30:00.000Z' }),
      createdAt: '2026-09-07T10:00:00.000Z',
    });
    await engine.push();
    expect(remote.pushed[0]!.updatedAt).toBe('2026-09-07T08:30:00.000Z');
  });

  it('falls back to the enqueue time when the payload has no updatedAt', async () => {
    const { engine, remote, queue } = setup();
    queue.enqueue({
      table: 'asset_snapshots',
      recordId: 's1',
      op: 'upsert',
      payload: makeSnapshot('s1', 'a1'),
      createdAt: '2026-09-07T10:00:00.000Z',
    });
    await engine.push();
    expect(remote.pushed[0]!.kind).toBe('snapshot');
    expect(remote.pushed[0]!.updatedAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('marks a soft delete with deletedAt and an empty payload', async () => {
    const { engine, remote, queue } = setup();
    queue.enqueue({
      table: 'assets',
      recordId: 'a1',
      op: 'delete',
      payload: makeAsset('a1'),
      createdAt: '2026-09-07T10:00:00.000Z',
    });
    await engine.push();
    expect(remote.pushed[0]!.deletedAt).not.toBeNull();
    const { buildAad, decodeRecord } = jest.requireActual('../codec') as typeof import('../codec');
    // 删除不需要上传明文内容
    expect(decodeRecord(remote.pushed[0]!.envelope, FDK, buildAad(FAMILY))).toEqual({});
  });

  it('uses the injected clock for delete timestamps', async () => {
    const { engine, remote, queue } = setup({ now: () => '2026-09-09T00:00:00.000Z' });
    queue.enqueue({
      table: 'assets',
      recordId: 'a1',
      op: 'delete',
      payload: makeAsset('a1'),
      createdAt: '2026-09-07T10:00:00.000Z',
    });
    await engine.push();
    expect(remote.pushed[0]!.deletedAt).toBe('2026-09-09T00:00:00.000Z');
  });

  it('marks entries failed when the remote rejects them', async () => {
    const { engine, remote, queue } = setup();
    remote.failPush = true;
    queue.enqueue({
      table: 'assets',
      recordId: 'a1',
      op: 'upsert',
      payload: makeAsset('a1'),
      createdAt: '2026-09-07T10:00:00.000Z',
    });
    const stats = await engine.push();
    expect(stats.failed).toBe(1);
    expect(queue.failed).toHaveLength(1);
    expect(queue.entries).toHaveLength(1); // 留在队列里等重试
  });

  it('round-trips between two devices sharing the same key', async () => {
    const deviceA = setup();
    deviceA.queue.enqueue({
      table: 'assets',
      recordId: 'a1',
      op: 'upsert',
      payload: makeAsset('a1', { currentAmount: 42_00 }),
      createdAt: '2026-09-07T10:00:00.000Z',
    });
    await deviceA.engine.push();

    const deviceB = setup();
    deviceB.remote.rows = deviceA.remote.pushed;
    const stats = await deviceB.engine.pull(['asset']);

    expect(stats.applied).toBe(1);
    expect(deviceB.assets.store.get('a1')?.currentAmount).toBe(42_00);
  });
});
