import { encryptEnvelope, decryptEnvelope, IV_BYTES, AUTH_TAG_BYTES, KEY_BYTES, wipeBytes, type EncryptedRecord } from '../envelope';
import { generateRandomBytes } from '../kdf';

const sampleKey = () => generateRandomBytes(KEY_BYTES);

describe('encryptEnvelope', () => {
  it('produces ciphertext + 12-byte IV + 16-byte authTag', () => {
    const key = sampleKey();
    const rec = encryptEnvelope(new TextEncoder().encode('hello'), key);
    expect(rec.iv.length).toBe(IV_BYTES);
    expect(rec.authTag.length).toBe(AUTH_TAG_BYTES);
    expect(rec.ciphertext.length).toBeGreaterThan(0);
    expect(rec.version).toBe(1);
  });

  it('rejects wrong-length key', () => {
    expect(() => encryptEnvelope(new Uint8Array([1, 2]), new Uint8Array(31))).toThrow(/32 bytes/);
  });

  it('uses unique IVs (collision check across 50 encrypts)', () => {
    const key = sampleKey();
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const r = encryptEnvelope(new TextEncoder().encode('x'), key);
      ivs.add(Buffer.from(r.iv).toString('hex'));
    }
    expect(ivs.size).toBe(50);
  });
});

describe('decryptEnvelope', () => {
  it('round-trips plaintext', () => {
    const key = sampleKey();
    const plaintext = new TextEncoder().encode('总资产 ¥1,285,432.68');
    const rec = encryptEnvelope(plaintext, key);
    const decoded = decryptEnvelope(rec, key);
    expect(new TextDecoder().decode(decoded)).toBe('总资产 ¥1,285,432.68');
  });

  it('round-trips with AAD binding', () => {
    const key = sampleKey();
    const aad = new TextEncoder().encode('family:abc/asset:123');
    const rec = encryptEnvelope(new TextEncoder().encode('data'), key, aad);
    const decoded = decryptEnvelope(rec, key, aad);
    expect(new TextDecoder().decode(decoded)).toBe('data');
  });

  it('rejects when wrong AAD', () => {
    const key = sampleKey();
    const rec = encryptEnvelope(new TextEncoder().encode('data'), key, new TextEncoder().encode('family:A'));
    expect(() => decryptEnvelope(rec, key, new TextEncoder().encode('family:B'))).toThrow(/decryption failed/);
  });

  it('rejects when wrong key', () => {
    const rec = encryptEnvelope(new TextEncoder().encode('data'), sampleKey());
    expect(() => decryptEnvelope(rec, sampleKey())).toThrow(/decryption failed/);
  });

  it('rejects tampered ciphertext', () => {
    const key = sampleKey();
    const rec = encryptEnvelope(new TextEncoder().encode('data'), key);
    rec.ciphertext[0]! ^= 0x01; // 翻转 1 bit
    expect(() => decryptEnvelope(rec, key)).toThrow(/decryption failed/);
  });

  it('rejects tampered authTag', () => {
    const key = sampleKey();
    const rec = encryptEnvelope(new TextEncoder().encode('data'), key);
    rec.authTag[0]! ^= 0x01;
    expect(() => decryptEnvelope(rec, key)).toThrow(/decryption failed/);
  });

  it('rejects unsupported version', () => {
    const key = sampleKey();
    const rec: EncryptedRecord = {
      version: 999 as never,
      iv: new Uint8Array(IV_BYTES),
      authTag: new Uint8Array(AUTH_TAG_BYTES),
      ciphertext: new Uint8Array([1, 2, 3]),
    };
    expect(() => decryptEnvelope(rec, key)).toThrow(/unsupported envelope version/);
  });

  it('rejects malformed IV', () => {
    const key = sampleKey();
    const rec: EncryptedRecord = {
      version: 1,
      iv: new Uint8Array(8), // 应为 12
      authTag: new Uint8Array(AUTH_TAG_BYTES),
      ciphertext: new Uint8Array([1, 2, 3]),
    };
    expect(() => decryptEnvelope(rec, key)).toThrow(/invalid IV length/);
  });
});

describe('wipeBytes', () => {
  it('zeroes all bytes in place', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]);
    wipeBytes(buf);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0, 0]);
  });
});