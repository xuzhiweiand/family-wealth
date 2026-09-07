import { enumerateDateKeys, formatDateKey, parseDateKey, toDateKey, MAX_TREND_POINTS } from '../date-utils';

describe('toDateKey', () => {
  it('takes the calendar-day prefix of an ISO datetime', () => {
    expect(toDateKey('2026-09-07T23:30:00+08:00')).toBe('2026-09-07');
    expect(toDateKey('2026-09-07')).toBe('2026-09-07');
    expect(toDateKey('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
  });
});

describe('parseDateKey / formatDateKey', () => {
  it('round-trips', () => {
    for (const key of ['2026-01-01', '2026-02-28', '2024-02-29', '2026-12-31']) {
      expect(formatDateKey(parseDateKey(key))).toBe(key);
    }
  });

  it('is timezone-independent (UTC based)', () => {
    expect(parseDateKey('2026-09-07')).toBe(Date.UTC(2026, 8, 7));
  });

  it('zero-pads single digit month/day', () => {
    expect(formatDateKey(Date.UTC(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('enumerateDateKeys', () => {
  it('returns inclusive ascending range', () => {
    expect(enumerateDateKeys('2026-09-05', '2026-09-08')).toEqual([
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
    ]);
  });

  it('returns single day when from === to', () => {
    expect(enumerateDateKeys('2026-09-07', '2026-09-07')).toEqual(['2026-09-07']);
  });

  it('returns empty when from > to', () => {
    expect(enumerateDateKeys('2026-09-08', '2026-09-05')).toEqual([]);
  });

  it('crosses month boundary', () => {
    const keys = enumerateDateKeys('2026-08-30', '2026-09-02');
    expect(keys).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('crosses a leap day', () => {
    const keys = enumerateDateKeys('2024-02-28', '2024-03-01');
    expect(keys).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });

  it('crosses year boundary', () => {
    const keys = enumerateDateKeys('2026-12-30', '2027-01-02');
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe('2026-12-30');
    expect(keys[3]).toBe('2027-01-02');
  });

  it('throws when the range exceeds maxPoints', () => {
    expect(() => enumerateDateKeys('2000-01-01', '2026-01-01')).toThrow(/date range too large/);
  });

  it('respects a custom maxPoints', () => {
    expect(() => enumerateDateKeys('2026-09-01', '2026-09-10', 5)).toThrow(/date range too large/);
    expect(enumerateDateKeys('2026-09-01', '2026-09-10', 10)).toHaveLength(10);
  });

  it('allows a range up to MAX_TREND_POINTS', () => {
    const keys = enumerateDateKeys('2026-01-01', '2026-12-31');
    expect(keys).toHaveLength(365);
    expect(MAX_TREND_POINTS).toBeGreaterThan(365);
  });
});
