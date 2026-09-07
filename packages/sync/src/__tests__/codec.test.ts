import { generateRandomBytes } from '@family-wealth/crypto';
import { buildAad, decodeRecord, encodeRecord } from '../codec';

const fdk = generateRandomBytes(32);
const aad = buildAad('family-1');

describe('buildAad', () => {
  it('binds the family id', () => {
    expect(new TextDecoder().decode(buildAad('family-1'))).toBe('family:family-1');
  });

  it('differs per family', () => {
    expect(buildAad('a')).not.toEqual(buildAad('b'));
  });
});

describe('encodeRecord / decodeRecord', () => {
  it('round-trips a plain object', () => {
    const payload = { id: 'a1', name: '招商银行', amount: 128543268 };
    const envelope = encodeRecord(payload, fdk, aad);
    expect(decodeRecord(envelope, fdk, aad)).toEqual(payload);
  });

  it('produces different ciphertext each time (随机 IV)', () => {
    const payload = { amount: 1 };
    expect(encodeRecord(payload, fdk, aad)).not.toBe(encodeRecord(payload, fdk, aad));
  });

  it('never leaks plaintext into the envelope', () => {
    const envelope = encodeRecord({ name: '招商银行活期' }, fdk, aad);
    expect(envelope).not.toContain('招商');
  });

  it('fails with a different FDK', () => {
    const envelope = encodeRecord({ amount: 1 }, fdk, aad);
    expect(decodeRecord(envelope, generateRandomBytes(32), aad)).toBeNull();
  });

  it('fails with a different AAD (跨家庭密文重放被拦下)', () => {
    const envelope = encodeRecord({ amount: 1 }, fdk, aad);
    expect(decodeRecord(envelope, fdk, buildAad('family-2'))).toBeNull();
  });

  it('fails when the ciphertext is tampered with', () => {
    const envelope = encodeRecord({ amount: 1 }, fdk, aad);
    const parsed = JSON.parse(envelope) as { ct: string; iv: string; tag: string; v: number };
    parsed.ct = `A${parsed.ct.slice(1)}`;
    expect(decodeRecord(JSON.stringify(parsed), fdk, aad)).toBeNull();
  });

  it('returns null for garbage instead of throwing', () => {
    expect(decodeRecord('not-an-envelope', fdk, aad)).toBeNull();
    expect(decodeRecord('{}', fdk, aad)).toBeNull();
  });
});
