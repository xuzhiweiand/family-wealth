import { deriveUMK, deriveFDK, generateSalt, generateRandomBytes, constantTimeEqual, PBKDF2_ITERATIONS, UMK_BYTES, FDK_BYTES, SALT_BYTES } from '../kdf';

describe('deriveUMK', () => {
  it('produces 32-byte UMK', () => {
    const salt = generateSalt();
    const umk = deriveUMK('hunter2', salt);
    expect(umk.length).toBe(UMK_BYTES);
  });

  it('is deterministic for same password + salt', () => {
    const salt = generateSalt();
    const a = deriveUMK('mypassword', salt);
    const b = deriveUMK('mypassword', salt);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it('produces different UMK for different salts', () => {
    const a = deriveUMK('mypassword', generateSalt());
    const b = deriveUMK('mypassword', generateSalt());
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('produces different UMK for different passwords', () => {
    const salt = generateSalt();
    const a = deriveUMK('password1', salt);
    const b = deriveUMK('password2', salt);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('rejects too-short salt', () => {
    expect(() => deriveUMK('x', new Uint8Array(8))).toThrow(/at least/);
  });

  it('uses 100k iterations (security baseline)', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100_000);
  });

  it('runs in < 1000ms on Node 22', () => {
    // 性能预算：Node 22 测试机 < 1000ms；RN 真机 < 200ms（见技术方案 §3）
    const salt = generateSalt();
    const t0 = Date.now();
    deriveUMK('p@ssw0rd!', salt);
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(1000);
  });
});

describe('deriveFDK', () => {
  it('produces 32-byte FDK', () => {
    const salt = generateSalt();
    const umk = deriveUMK('p', salt);
    const fdk = deriveFDK(umk, 'fam-abc');
    expect(fdk.length).toBe(FDK_BYTES);
  });

  it('produces different FDK for different familyId', () => {
    const salt = generateSalt();
    const umk = deriveUMK('p', salt);
    const fdkA = deriveFDK(umk, 'fam-A');
    const fdkB = deriveFDK(umk, 'fam-B');
    expect(constantTimeEqual(fdkA, fdkB)).toBe(false);
  });

  it('produces different FDK for different UMK', () => {
    const saltA = generateSalt();
    const saltB = generateSalt();
    const umkA = deriveUMK('p', saltA);
    const umkB = deriveUMK('p', saltB);
    const fdkA = deriveFDK(umkA, 'fam-1');
    const fdkB = deriveFDK(umkB, 'fam-1');
    expect(constantTimeEqual(fdkA, fdkB)).toBe(false);
  });

  it('is deterministic', () => {
    const salt = generateSalt();
    const umk = deriveUMK('p', salt);
    const a = deriveFDK(umk, 'fam-X');
    const b = deriveFDK(umk, 'fam-X');
    expect(constantTimeEqual(a, b)).toBe(true);
  });
});

describe('generateSalt / generateRandomBytes', () => {
  it('returns requested length', () => {
    expect(generateSalt().length).toBe(SALT_BYTES);
    expect(generateRandomBytes(24).length).toBe(24);
  });

  it('returns unique values across calls', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical buffers', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });
  it('returns false for different-length buffers', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });
  it('returns false for different content', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});