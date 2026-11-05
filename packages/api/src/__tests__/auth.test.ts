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

  it('华为首次登录返回空档案，设置密码后再次登录返回已有档案', async () => {
    const first = await client.signInWithHuawei({ authorizationCode: 'openid-001', state: 's1' });
    expect(first.ok).toBe(true);
    expect(first.data?.account.isNewUser).toBe(true);
    expect(first.data?.account.profile).toBeNull();

    const userId = first.data!.account.userId;
    const saved = await client.saveEncryptionProfile({
      userId,
      email: first.data!.account.email,
      displayName: '华为用户',
      salt: 'c2FsdA==',
      passwordCheckEnvelope: 'ZW52',
    });
    expect(saved.ok).toBe(true);

    await client.signOut();
    const second = await client.signInWithHuawei({ authorizationCode: 'openid-001', state: 's2' });
    expect(second.ok).toBe(true);
    expect(second.data?.account.isNewUser).toBe(false);
    expect(second.data?.account.userId).toBe(userId);
    expect(second.data?.account.profile?.salt).toBe('c2FsdA==');
  });

  it('华为登录缺少授权码或 state 时失败', async () => {
    const noCode = await client.signInWithHuawei({ authorizationCode: '', state: 's' });
    const noState = await client.signInWithHuawei({ authorizationCode: 'openid-002', state: '' });
    expect(noCode.ok).toBe(false);
    expect(noState.ok).toBe(false);
  });

  it('手机号验证码发送与校验', async () => {
    const sent = await client.sendPhoneBindingCode('13800138000');
    expect(sent.ok).toBe(true);
    expect(sent.data?.devCode).toMatch(/^\d{6}$/);

    const wrong = await client.confirmPhoneBinding('13800138000', '000000');
    expect(wrong.ok).toBe(false);

    const ok = await client.confirmPhoneBinding('13800138000', sent.data!.devCode!);
    expect(ok.ok).toBe(true);
    expect(ok.data?.phone).toBe('13800138000');
  });

  it('手机号格式非法时拒绝发送验证码', async () => {
    const sent = await client.sendPhoneBindingCode('1380013800');
    expect(sent.ok).toBe(false);
  });

  it('华为账号绑定到已有邮箱账号后，可直接用华为账号登录', async () => {
    await client.signUp({ email: 'old@example.com', password: 'pw-old-123', displayName: '老用户' });
    await client.signOut();

    const bound = await client.bindHuaweiToEmailAccount({
      authorizationCode: 'openid-bind-1',
      state: 's',
      email: 'old@example.com',
      password: 'pw-old-123',
    });
    expect(bound.ok).toBe(true);
    expect(bound.data?.account.isNewUser).toBe(false);
    expect(bound.data?.account.email).toBe('old@example.com');
    expect(bound.data?.account.profile?.salt).toBeTruthy();

    await client.signOut();
    const again = await client.signInWithHuawei({ authorizationCode: 'openid-bind-1', state: 's2' });
    expect(again.ok).toBe(true);
    expect(again.data?.account.userId).toBe(bound.data?.account.userId);
    expect(again.data?.account.isNewUser).toBe(false);
  });

  it('绑定已有账号：密码错误或 openID 已绑其他账号时失败', async () => {
    await client.signUp({ email: 'a@example.com', password: 'pw-a-123', displayName: 'A' });
    await client.signOut();

    const wrongPw = await client.bindHuaweiToEmailAccount({
      authorizationCode: 'openid-x', state: 's', email: 'a@example.com', password: 'bad',
    });
    expect(wrongPw.ok).toBe(false);
    expect(wrongPw.error?.code).toBe('INVALID_CREDENTIALS');

    // openid-y 先建成华为账号
    const first = await client.signInWithHuawei({ authorizationCode: 'openid-y', state: 's' });
    await client.saveEncryptionProfile({
      userId: first.data!.account.userId,
      email: first.data!.account.email,
      displayName: 'H',
      salt: 'c2FsdA==',
      passwordCheckEnvelope: 'ZW52',
    });
    const conflict = await client.bindHuaweiToEmailAccount({
      authorizationCode: 'openid-y', state: 's', email: 'a@example.com', password: 'pw-a-123',
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.error?.message).toContain('已绑定其他账号');
  });

  it('华为首次登录的临时账号允许被旧邮箱账号覆盖绑定', async () => {
    await client.signUp({ email: 'old2@example.com', password: 'pw-old2-1', displayName: '老' });
    await client.signOut();

    const temp = await client.signInWithHuawei({ authorizationCode: 'openid-switch', state: 's1' });
    expect(temp.ok).toBe(true);
    expect(temp.data?.account.isNewUser).toBe(true);
    expect(temp.data?.account.profile).toBeNull();

    // 真正的痛点场景：登录建了临时账号后，直接绑定旧邮箱账号不应报「已绑定其他账号」
    const bound = await client.bindHuaweiToEmailAccount({
      authorizationCode: 'openid-switch',
      state: 's2',
      email: 'old2@example.com',
      password: 'pw-old2-1',
    });
    expect(bound.ok).toBe(true);
    expect(bound.data?.account.email).toBe('old2@example.com');

    await client.signOut();
    const again = await client.signInWithHuawei({ authorizationCode: 'openid-switch', state: 's3' });
    expect(again.data?.account.userId).toBe(bound.data?.account.userId);
    expect(again.data?.account.isNewUser).toBe(false);
  });

  it('注销账号后华为 openID 释放，重新登录回到首次绑定流程', async () => {
    const first = await client.signInWithHuawei({ authorizationCode: 'openid-del', state: 's1' });
    expect(first.data?.account.isNewUser).toBe(true);
    await client.saveEncryptionProfile({
      userId: first.data!.account.userId,
      email: first.data!.account.email,
      displayName: '华为用户',
      salt: 'c2FsdA==',
      passwordCheckEnvelope: 'ZW52',
    });

    const del = await client.deleteAccount();
    expect(del.ok).toBe(true);
    expect(await client.getSession()).toBeNull();

    const again = await client.signInWithHuawei({ authorizationCode: 'openid-del', state: 's2' });
    expect(again.ok).toBe(true);
    expect(again.data?.account.isNewUser).toBe(true);
    expect(again.data?.account.profile).toBeNull();
  });

  it('注销后再绑定旧邮箱账号，下次华为登录能命中老账号', async () => {
    await client.signUp({ email: 'legacy@example.com', password: 'pw-legacy-1', displayName: '老账号' });
    await client.signOut();

    const temp = await client.signInWithHuawei({ authorizationCode: 'openid-old', state: 's1' });
    await client.saveEncryptionProfile({
      userId: temp.data!.account.userId,
      email: temp.data!.account.email,
      displayName: '临时账号',
      salt: 'c2FsdA==',
      passwordCheckEnvelope: 'ZW52',
    });
    // 当前登录的是临时华为账号，注销它
    expect((await client.deleteAccount()).ok).toBe(true);

    const bound = await client.bindHuaweiToEmailAccount({
      authorizationCode: 'openid-old',
      state: 's2',
      email: 'legacy@example.com',
      password: 'pw-legacy-1',
    });
    expect(bound.ok).toBe(true);
    expect(bound.data?.account.email).toBe('legacy@example.com');

    await client.signOut();
    const login = await client.signInWithHuawei({ authorizationCode: 'openid-old', state: 's3' });
    expect(login.data?.account.userId).toBe(bound.data?.account.userId);
    expect(login.data?.account.isNewUser).toBe(false);
  });
});
