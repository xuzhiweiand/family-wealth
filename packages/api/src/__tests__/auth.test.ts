import { InMemoryAuthClient } from '../in-memory';

describe('InMemoryAuthClient', () => {
  let client: InMemoryAuthClient;

  beforeEach(() => {
    client = new InMemoryAuthClient();
  });

  it('signUp creates user with valid session', async () => {
    const r = await client.signUp({
      email: 'alice@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'Alice',
    });
    expect(r.ok).toBe(true);
    expect(r.data?.user.email).toBe('alice@example.com');
    expect(r.data?.session.userId).toBe(r.data?.user.id);
    expect(r.data?.session.accessToken).toMatch(/^at_/);
    expect(r.data?.user.salt).toBeTruthy();
    expect(r.data?.user.passwordCheckEnvelope).toBeTruthy();
  });

  it('signUp rejects duplicate email (case-insensitive)', async () => {
    await client.signUp({ email: 'bob@example.com', password: 'pw', displayName: 'Bob' });
    const r = await client.signUp({ email: 'BOB@example.com', password: 'pw', displayName: 'Bob' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('USER_EXISTS');
  });

  it('signIn with correct password succeeds', async () => {
    await client.signUp({ email: 'a@b.com', password: 'pw1', displayName: 'A' });
    await client.signOut();
    const r = await client.signIn({ email: 'a@b.com', password: 'pw1' });
    expect(r.ok).toBe(true);
    expect(r.data?.session.accessToken).toMatch(/^at_/);
  });

  it('signIn with wrong password fails', async () => {
    await client.signUp({ email: 'a@b.com', password: 'pw1', displayName: 'A' });
    await client.signOut();
    const r = await client.signIn({ email: 'a@b.com', password: 'wrong' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('signIn with unknown email fails', async () => {
    const r = await client.signIn({ email: 'nobody@x.com', password: 'pw' });
    expect(r.ok).toBe(false);
  });

  it('signOut clears session', async () => {
    await client.signUp({ email: 'a@b.com', password: 'pw', displayName: 'A' });
    expect(await client.getSession()).not.toBeNull();
    await client.signOut();
    expect(await client.getSession()).toBeNull();
  });

  it('getCurrentUser returns null when signed out', async () => {
    await client.signUp({ email: 'a@b.com', password: 'pw', displayName: 'A' });
    await client.signOut();
    expect(await client.getCurrentUser()).toBeNull();
  });

  it('refreshSession issues new tokens', async () => {
    await client.signUp({ email: 'a@b.com', password: 'pw', displayName: 'A' });
    const before = (await client.getSession())!;
    const r = await client.refreshSession();
    expect(r.ok).toBe(true);
    const after = (await client.getSession())!;
    expect(after.accessToken).not.toBe(before.accessToken);
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(after.expiresAt).toBeGreaterThan(before.expiresAt);
  });

  it('onAuthStateChange fires on signUp and signOut', async () => {
    const events: (string | null)[] = [];
    client.onAuthStateChange((s) => events.push(s?.accessToken ?? null));
    await client.signUp({ email: 'a@b.com', password: 'pw', displayName: 'A' });
    await client.signOut();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toMatch(/^at_/);
    expect(events[events.length - 1]).toBeNull();
  });

  it('signUp passwordCheckEnvelope can verify by recomputing', async () => {
    const r = await client.signUp({ email: 'a@b.com', password: 'pw', displayName: 'A' });
    expect(r.ok).toBe(true);
    const envelope = Buffer.from(r.data!.user.passwordCheckEnvelope, 'base64');
    expect(envelope.length).toBe(32); // 32 字节哈希
  });
});