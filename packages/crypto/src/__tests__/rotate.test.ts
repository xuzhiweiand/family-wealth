import { encryptEnvelope, decryptEnvelope, IV_BYTES } from '../envelope';
import { rewrapEnvelope, rewrapMany, changePassword } from '../rotate';
import { deriveUMK, deriveFDK, generateSalt, generateRandomBytes } from '../kdf';

describe('rewrapEnvelope', () => {
  it('rewraps with new FDK and produces decryptable result', () => {
    const oldFdk = generateRandomBytes(32);
    const newFdk = generateRandomBytes(32);
    const aad = new TextEncoder().encode('family:abc');
    const rec = encryptEnvelope(new TextEncoder().encode('总资产'), oldFdk, aad);
    const { reEncrypted, ivChanged } = rewrapEnvelope(rec, oldFdk, newFdk, aad);
    expect(ivChanged).toBe(true);
    expect(Buffer.from(reEncrypted.iv).toString('hex')).not.toBe(Buffer.from(rec.iv).toString('hex'));
    const decoded = decryptEnvelope(reEncrypted, newFdk, aad);
    expect(new TextDecoder().decode(decoded)).toBe('总资产');
  });

  it('rejects wrong old FDK', () => {
    const aad = new TextEncoder().encode('a');
    const rec = encryptEnvelope(new TextEncoder().encode('x'), generateRandomBytes(32), aad);
    expect(() => rewrapEnvelope(rec, generateRandomBytes(32), generateRandomBytes(32), aad)).toThrow();
  });

  it('rejects mismatched AAD', () => {
    const oldFdk = generateRandomBytes(32);
    const newFdk = generateRandomBytes(32);
    const rec = encryptEnvelope(new TextEncoder().encode('x'), oldFdk, new TextEncoder().encode('a'));
    expect(() => rewrapEnvelope(rec, oldFdk, newFdk, new TextEncoder().encode('b'))).toThrow();
  });

  it('guarantees new IV is different (no IV reuse)', () => {
    const oldFdk = generateRandomBytes(32);
    const newFdk = generateRandomBytes(32);
    const rec = encryptEnvelope(new TextEncoder().encode('x'), oldFdk);
    const { reEncrypted } = rewrapEnvelope(rec, oldFdk, newFdk);
    expect(reEncrypted.iv).toHaveLength(IV_BYTES);
    expect(Buffer.from(reEncrypted.iv).toString('hex')).not.toBe(Buffer.from(rec.iv).toString('hex'));
  });
});

describe('rewrapMany', () => {
  it('rewraps all records in batch', () => {
    const oldFdk = generateRandomBytes(32);
    const newFdk = generateRandomBytes(32);
    const records = Array.from({ length: 5 }, (_, i) =>
      encryptEnvelope(new TextEncoder().encode(`record-${i}`), oldFdk),
    );
    const rewrapped = rewrapMany(records, oldFdk, newFdk);
    expect(rewrapped.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      const decoded = decryptEnvelope(rewrapped[i]!, newFdk);
      expect(new TextDecoder().decode(decoded)).toBe(`record-${i}`);
    }
  });
});

describe('changePassword', () => {
  it('derives new UMK + FDKs for all families', () => {
    const oldSalt = generateSalt();
    const newSalt = generateSalt();
    const oldUmk = deriveUMK('old-password', oldSalt);
    const result = changePassword({
      oldPassword: 'old-password',
      newPassword: 'new-password',
      oldSalt,
      newSalt,
      familyIds: ['fam-A', 'fam-B'],
    });
    expect(result.newUmk.length).toBe(32);
    expect(result.newFdks.size).toBe(2);
    expect(result.newFdks.has('fam-A')).toBe(true);
    expect(result.newFdks.has('fam-B')).toBe(true);
    // FDK-A 与 FDK-B 应不同
    expect(Buffer.from(result.newFdks.get('fam-A')!).toString('hex')).not.toBe(
      Buffer.from(result.newFdks.get('fam-B')!).toString('hex'),
    );
    // FDK 应可用旧 UMK 派生的不同
    const oldFdk = deriveFDK(oldUmk, 'fam-A');
    expect(Buffer.from(result.newFdks.get('fam-A')!).toString('hex')).not.toBe(Buffer.from(oldFdk).toString('hex'));
  });

  it('produces FDKs that can decrypt previously encrypted data', () => {
    const oldSalt = generateSalt();
    const newSalt = generateSalt();
    const oldUmk = deriveUMK('old', oldSalt);
    const oldFdk = deriveFDK(oldUmk, 'fam-1');
    const plaintext = new TextEncoder().encode('账户余额');
    const rec = encryptEnvelope(plaintext, oldFdk);

    const { newFdks } = changePassword({
      oldPassword: 'old',
      newPassword: 'new',
      oldSalt,
      newSalt,
      familyIds: ['fam-1'],
    });
    const newFdk = newFdks.get('fam-1')!;
    const rewrapped = rewrapEnvelope(rec, oldFdk, newFdk);
    const decoded = decryptEnvelope(rewrapped.reEncrypted, newFdk);
    expect(new TextDecoder().decode(decoded)).toBe('账户余额');
  });
});