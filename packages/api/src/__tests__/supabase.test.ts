import { SupabaseAuthClient } from '../supabase';
import { generateSalt, toBase64, createPasswordCheckEnvelope } from '@family-wealth/crypto';
import type { AuthErrorLike, SupabaseSession, SupabaseUser } from '../supabase';

const PASSWORD = 'correct-horse-battery-staple';

/** 构造最小可用的 Supabase User 对象 */
function fakeSupabaseUser(id = 'user-1', email = 'alice@example.com'): SupabaseUser {
  return {
    id,
    email,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: { display_name: 'Alice' },
    created_at: '2026-09-07T00:00:00Z',
  } as unknown as SupabaseUser;
}

/** 构造最小可用的 Supabase Session 对象 */
function fakeSupabaseSession(user = fakeSupabaseUser()): SupabaseSession {
  return {
    access_token: 'at_fake',
    refresh_token: 'rt_fake',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  } as unknown as SupabaseSession;
}

function authError(status: number, code?: string, message = 'auth error'): AuthErrorLike {
  return { status, code, message } as AuthErrorLike;
}

/** 构建一个可配置的 fake SupabaseClient（只实现本 client 用到的面） */
function fakeSupabase(overrides: {
  signUp?: jest.Mock;
  signIn?: jest.Mock;
  signOut?: jest.Mock;
  getUser?: jest.Mock;
  getSession?: jest.Mock;
  refreshSession?: jest.Mock;
  onAuthStateChange?: jest.Mock;
  profileRow?: Record<string, unknown> | null;
} = {}) {
  const signUp = overrides.signUp ?? jest.fn();
  const signIn = overrides.signIn ?? jest.fn();
  const signOut = overrides.signOut ?? jest.fn();
  const getUser = overrides.getUser ?? jest.fn();
  const getSession = overrides.getSession ?? jest.fn();
  const refreshSession = overrides.refreshSession ?? jest.fn();
  const onAuthStateChange = overrides.onAuthStateChange ?? jest.fn();

  const profileSelect = {
    single: jest.fn(async () => ({ data: overrides.profileRow ?? null, error: null })),
  };
  const profileEq = { eq: jest.fn(() => profileSelect) };
  const profileFrom = {
    select: jest.fn(() => profileEq),
    upsert: jest.fn(async (_row: Record<string, unknown>) => ({ data: null, error: null })),
  };

  const client = {
    auth: {
      signUp,
      signInWithPassword: signIn,
      signOut,
      getUser,
      getSession,
      refreshSession,
      onAuthStateChange,
    },
    from: jest.fn(() => profileFrom),
  };
  return { client: client as never, auth: client.auth, signUp, signIn, signOut, getUser, getSession, refreshSession, onAuthStateChange, profileFrom, profileSelect };
}

describe('SupabaseAuthClient', () => {
  it('signUp calls supabase signUp, writes profile with salt+envelope, returns mapped data', async () => {
    const user = fakeSupabaseUser();
    const session = fakeSupabaseSession(user);
    const { client, signUp, profileFrom } = fakeSupabase();
    signUp.mockResolvedValue({ data: { user, session }, error: null });

    const c = new SupabaseAuthClient(client);
    const r = await c.signUp({ email: 'alice@example.com', password: PASSWORD, displayName: 'Alice' });

    expect(r.ok).toBe(true);
    expect(signUp).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: PASSWORD,
      options: { data: { display_name: 'Alice' } },
    });
    expect(r.data?.user.id).toBe('user-1');
    expect(r.data?.user.email).toBe('alice@example.com');
    expect(r.data?.user.salt).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(r.data?.session.accessToken).toBe('at_fake');
    expect(r.data?.session.expiresAt).toBeGreaterThan(0);

    // profile 写入了 salt + password_check_envelope
    const upserted = profileFrom.upsert.mock.calls[0]![0];
    expect(upserted['id']).toBe('user-1');
    expect(upserted['salt']).toBe(r.data?.user.salt);
    expect(typeof upserted['password_check_envelope']).toBe('string');
  });

  it('signIn verifies password envelope and returns mapped data', async () => {
    const salt = generateSalt();
    const envelope = createPasswordCheckEnvelope(PASSWORD, salt);
    const user = fakeSupabaseUser();
    const session = fakeSupabaseSession(user);
    const profileRow = {
      id: 'user-1',
      email: 'alice@example.com',
      display_name: 'Alice',
      salt: toBase64(salt),
      password_check_envelope: envelope,
    };
    const { client, signIn } = fakeSupabase({ profileRow });
    signIn.mockResolvedValue({ data: { user, session }, error: null });

    const c = new SupabaseAuthClient(client);
    const r = await c.signIn({ email: 'alice@example.com', password: PASSWORD });

    expect(r.ok).toBe(true);
    expect(r.data?.user.passwordCheckEnvelope).toBe(envelope);
    expect(r.data?.session.accessToken).toBe('at_fake');
  });

  it('signIn maps invalid_credentials error', async () => {
    const { client, signIn } = fakeSupabase();
    signIn.mockResolvedValue({ data: { user: null, session: null }, error: authError(400, 'invalid_credentials', 'Invalid login credentials') });

    const c = new SupabaseAuthClient(client);
    const r = await c.signIn({ email: 'a@b.com', password: 'wrong' });

    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('signIn fails when salt is tampered (envelope verification fails)', async () => {
    const salt = generateSalt();
    const envelope = createPasswordCheckEnvelope(PASSWORD, salt);
    const user = fakeSupabaseUser();
    const session = fakeSupabaseSession(user);
    // 故意用不同的 salt，使 UMK 派生不一致 → envelope 校验失败
    const tamperedProfile = {
      id: 'user-1',
      email: 'alice@example.com',
      display_name: 'Alice',
      salt: toBase64(generateSalt()),
      password_check_envelope: envelope,
    };
    const { client, signIn } = fakeSupabase({ profileRow: tamperedProfile });
    signIn.mockResolvedValue({ data: { user, session }, error: null });

    const c = new SupabaseAuthClient(client);
    const r = await c.signIn({ email: 'alice@example.com', password: PASSWORD });

    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps network error when status is 0', async () => {
    const { client, signIn } = fakeSupabase();
    signIn.mockResolvedValue({ data: { user: null, session: null }, error: authError(0, undefined, 'fetch failed') });

    const c = new SupabaseAuthClient(client);
    const r = await c.signIn({ email: 'a@b.com', password: 'pw' });

    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('NETWORK');
  });

  it('signOut clears session and profile cache', async () => {
    const { client, signOut } = fakeSupabase();
    signOut.mockResolvedValue({ error: null });

    const c = new SupabaseAuthClient(client);
    await c.signOut();
    expect(signOut).toHaveBeenCalled();
  });

  it('getSession maps Supabase session to domain Session', async () => {
    const session = fakeSupabaseSession();
    const { client, getSession } = fakeSupabase();
    getSession.mockResolvedValue({ data: { session }, error: null });

    const c = new SupabaseAuthClient(client);
    const s = await c.getSession();
    expect(s?.accessToken).toBe('at_fake');
    expect(s?.refreshToken).toBe('rt_fake');
    expect(s?.userId).toBe('user-1');
  });

  it('refreshSession maps new session', async () => {
    const session = fakeSupabaseSession();
    const { client, refreshSession } = fakeSupabase();
    refreshSession.mockResolvedValue({ data: { session, user: session.user }, error: null });

    const c = new SupabaseAuthClient(client);
    const r = await c.refreshSession();
    expect(r.ok).toBe(true);
    expect(r.data?.accessToken).toBe('at_fake');
  });

  it('onAuthStateChange returns unsubscribe that detaches subscription', async () => {
    const unsubscribe = jest.fn();
    const { client, onAuthStateChange } = fakeSupabase();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });

    const c = new SupabaseAuthClient(client);
    const off = c.onAuthStateChange(() => {});
    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
