import { computeNextCursor, resolveConflict } from '../conflict';

describe('resolveConflict', () => {
  it('takes the remote row when local does not exist yet', () => {
    expect(resolveConflict(null, { updatedAt: '2026-09-07T00:00:00Z', deletedAt: null })).toBe('remote');
  });

  it('prefers remote when it is newer', () => {
    expect(
      resolveConflict(
        { updatedAt: '2026-09-07T10:00:00Z', deletedAt: null },
        { updatedAt: '2026-09-07T11:00:00Z', deletedAt: null },
      ),
    ).toBe('remote');
  });

  it('prefers local when it is newer', () => {
    expect(
      resolveConflict(
        { updatedAt: '2026-09-07T11:00:00Z', deletedAt: null },
        { updatedAt: '2026-09-07T10:00:00Z', deletedAt: null },
      ),
    ).toBe('local');
  });

  it('keeps local when timestamps are identical (避免抖动)', () => {
    expect(
      resolveConflict(
        { updatedAt: '2026-09-07T10:00:00Z', deletedAt: null },
        { updatedAt: '2026-09-07T10:00:00Z', deletedAt: null },
      ),
    ).toBe('local');
  });

  it('honours a remote soft delete even when local is newer', () => {
    expect(
      resolveConflict(
        { updatedAt: '2026-09-07T12:00:00Z', deletedAt: null },
        { updatedAt: '2026-09-07T10:00:00Z', deletedAt: '2026-09-07T10:00:00Z' },
      ),
    ).toBe('remote');
  });

  it('keeps a local soft delete over a newer remote edit (财务数据宁可多留)', () => {
    expect(
      resolveConflict(
        { updatedAt: '2026-09-07T10:00:00Z', deletedAt: '2026-09-07T10:00:00Z' },
        { updatedAt: '2026-09-07T12:00:00Z', deletedAt: null },
      ),
    ).toBe('local');
  });

  it('falls back to LWW when both sides are deleted', () => {
    expect(
      resolveConflict(
        { updatedAt: '2026-09-07T10:00:00Z', deletedAt: '2026-09-07T10:00:00Z' },
        { updatedAt: '2026-09-07T12:00:00Z', deletedAt: '2026-09-07T12:00:00Z' },
      ),
    ).toBe('remote');
  });
});

describe('computeNextCursor', () => {
  it('returns null for no rows and no previous cursor', () => {
    expect(computeNextCursor([])).toBeNull();
  });

  it('returns null for no rows but keeps the previous cursor', () => {
    expect(computeNextCursor([], '2026-09-07T00:00:00Z')).toBe('2026-09-07T00:00:00Z');
  });

  it('takes the maximum updatedAt regardless of order', () => {
    const rows = [
      { updatedAt: '2026-09-07T12:00:00Z' },
      { updatedAt: '2026-09-07T09:00:00Z' },
      { updatedAt: '2026-09-07T15:00:00Z' },
    ];
    expect(computeNextCursor(rows)).toBe('2026-09-07T15:00:00Z');
  });

  it('never goes backwards', () => {
    const rows = [{ updatedAt: '2026-09-01T00:00:00Z' }];
    expect(computeNextCursor(rows, '2026-09-07T00:00:00Z')).toBe('2026-09-07T00:00:00Z');
  });

  it('advances when a newer row arrives', () => {
    const rows = [{ updatedAt: '2026-09-09T00:00:00Z' }];
    expect(computeNextCursor(rows, '2026-09-07T00:00:00Z')).toBe('2026-09-09T00:00:00Z');
  });
});
