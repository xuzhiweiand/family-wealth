import {
  createPasswordCheckEnvelope,
  verifyPasswordCheck,
  serializeEnvelope,
  deserializeEnvelope,
  PASSWORD_CHECK_PLAINTEXT,
} from '../password-check';
import { generateSalt } from '../kdf';

describe('createPasswordCheckEnvelope / verifyPasswordCheck', () => {
  it('round-trips: correct password + salt verifies true', () => {
    const salt = generateSalt();
    const env = createPasswordCheckEnvelope('correct-horse-battery-staple', salt);
    expect(typeof env).toBe('string');
    expect(verifyPasswordCheck('correct-horse-battery-staple', salt, env)).toBe(true);
  });

  it('rejects wrong password', () => {
    const salt = generateSalt();
    const env = createPasswordCheckEnvelope('right-password', salt);
    expect(verifyPasswordCheck('wrong-password', salt, env)).toBe(false);
  });

  it('rejects wrong salt (tamper detection)', () => {
    const salt = generateSalt();
    const env = createPasswordCheckEnvelope('right-password', salt);
    expect(verifyPasswordCheck('right-password', generateSalt(), env)).toBe(false);
  });

  it('rejects tampered envelope', () => {
    const salt = generateSalt();
    const env = createPasswordCheckEnvelope('right-password', salt);
    const rec = deserializeEnvelope(env)!;
    rec.ciphertext[0]! ^= 0x01; // 翻转 1 bit
    expect(verifyPasswordCheck('right-password', salt, serializeEnvelope(rec))).toBe(false);
  });

  it('rejects malformed envelope string', () => {
    const salt = generateSalt();
    expect(verifyPasswordCheck('pw', salt, 'not-json')).toBe(false);
    expect(verifyPasswordCheck('pw', salt, '{}')).toBe(false);
  });

  it('produces unique envelopes across calls (random IV)', () => {
    const salt = generateSalt();
    const a = createPasswordCheckEnvelope('pw', salt);
    const b = createPasswordCheckEnvelope('pw', salt);
    expect(a).not.toBe(b);
  });
});

describe('serializeEnvelope / deserializeEnvelope', () => {
  it('round-trips a valid record', () => {
    const salt = generateSalt();
    const env = createPasswordCheckEnvelope('pw', salt);
    const rec = deserializeEnvelope(env);
    expect(rec).not.toBeNull();
    expect(serializeEnvelope(rec!)).toBe(env);
  });

  it('returns null for garbage input', () => {
    expect(deserializeEnvelope('')).toBeNull();
    expect(deserializeEnvelope('{"v":"x"}')).toBeNull();
    expect(deserializeEnvelope('garbage')).toBeNull();
  });
});

describe('PASSWORD_CHECK_PLAINTEXT', () => {
  it('is versioned and non-empty', () => {
    expect(PASSWORD_CHECK_PLAINTEXT).toMatch(/^family-wealth:password-check:v\d+/);
  });
});
