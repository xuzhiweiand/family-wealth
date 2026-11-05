/**
 * huawei-auth — 华为账号授权登录（Account Kit 授权登录，非一键登录）
 *
 * 客户端只提交系统授权页回传的 authorizationCode + state；App Secret
 * 仅存在于本函数环境变量中。流程：
 *   1. code → 华为 access token
 *   2. access token → 华为 userinfo（openid / nickname）
 *   3. openid → profiles_huawei 找到已有账号，否则用 Admin API 建号并关联
 *   4. 读取 profiles 的 salt + 密码校验信封，决定客户端走「设置密码」还是「输入原密码」
 *   5. 用 Admin generate_link + verify 签发真实 Supabase 会话（含 refresh token）
 *
 * 环境变量：
 *   HUAWEI_CLIENT_ID / HUAWEI_CLIENT_SECRET   华为 AGC 应用凭据（必填）
 *   HUAWEI_REDIRECT_URI                       与授权请求一致的回调地址（可选）
 *   SUPABASE_URL / SUPABASE_ANON_KEY          平台自动注入
 *   SUPABASE_SERVICE_ROLE_KEY                 平台自动注入
 */

const HUAWEI_TOKEN_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
/**
 * 解析用户级凭证。HarmonyOS Account Kit 下发的授权码换取到的 access token
 * 需用该接口解析出 open_id / union_id（userinfo 接口不适用于该授权码）。
 */
const HUAWEI_TOKEN_INFO_URL =
  'https://oauth-api.cloud.huawei.com/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  authorizationCode?: string;
  state?: string;
  deviceId?: string;
  /** login（默认）| bind（绑定已有邮箱账号）| delete-account（注销账号） */
  action?: 'login' | 'bind' | 'delete-account';
  /** bind：已有邮箱账号凭据 */
  email?: string;
  password?: string;
  /** delete-account：当前会话 accessToken，用于识别要注销的账号 */
  accessToken?: string;
}

interface HuaweiUserInfo {
  openid?: string;
  unionid?: string;
  nickname?: string;
  headPictureURL?: string;
}

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function env(name: string): string {
  return Deno.env.get(name) ?? '';
}

function serviceHeaders(): Record<string, string> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: 'return=representation',
  };
}

function restUrl(path: string): string {
  return `${env('SUPABASE_URL')}/rest/v1${path}`;
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 用 authorization code 换取华为 access token */
async function exchangeHuaweiCode(code: string): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: env('HUAWEI_CLIENT_ID'),
    client_secret: env('HUAWEI_CLIENT_SECRET'),
  });
  const redirectUri = env('HUAWEI_REDIRECT_URI');
  if (redirectUri) form.set('redirect_uri', redirectUri);

  const res = await fetch(HUAWEI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await readJson<{ access_token?: string; error?: string; error_description?: string }>(res);
  if (!res.ok || !body?.access_token) {
    throw new Error(body?.error_description ?? body?.error ?? '华为授权码换取 token 失败');
  }
  return body.access_token;
}

/** 解析 Access Token，获取华为账号 openid / unionid */
async function fetchHuaweiUserInfo(accessToken: string): Promise<HuaweiUserInfo> {
  const res = await fetch(HUAWEI_TOKEN_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: accessToken, open_id: 'OPENID' }).toString(),
  });
  const body = await readJson<{ open_id?: string; union_id?: string; error?: string }>(res);
  if (!res.ok || !body?.open_id) {
    throw new Error(body?.error ?? '获取华为账号信息失败');
  }
  return { openid: body.open_id, unionid: body.union_id };
}

async function findUserIdByOpenId(openId: string): Promise<string | null> {
  const res = await fetch(
    restUrl(`/profiles_huawei?open_id=eq.${encodeURIComponent(openId)}&select=user_id`),
    { headers: serviceHeaders() },
  );
  if (!res.ok) {
    const err = await readJson<{ message?: string }>(res);
    throw new Error(
      err?.message ?? `账号查询失败（HTTP ${res.status}），请确认 profiles_huawei 迁移已执行`,
    );
  }
  const rows = await readJson<Array<{ user_id: string }>>(res);
  return rows?.[0]?.user_id ?? null;
}

function huaweiEmail(openId: string): string {
  // openid 可能含特殊字符，用稳定哈希构造内部邮箱，避免暴露原始标识
  let hash = 0;
  for (let i = 0; i < openId.length; i++) {
    hash = (hash * 31 + openId.charCodeAt(i)) >>> 0;
  }
  return `hw_${hash.toString(16).padStart(8, '0')}@huawei-login.example.com`;
}

async function createAuthUser(email: string, displayName: string, openId: string): Promise<string> {
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { display_name: displayName },
      app_metadata: { provider: 'huawei', open_id: openId },
    }),
  });
  const body = await readJson<{ id?: string; user?: { id?: string }; msg?: string }>(res);
  const userId = body?.user?.id ?? body?.id;
  if (!res.ok || !userId) {
    throw new Error(body?.msg ?? '创建账号失败');
  }
  return userId;
}

async function linkHuaweiAccount(params: {
  openId: string;
  unionId: string | null;
  userId: string;
  displayName: string;
}): Promise<void> {
  const res = await fetch(restUrl('/profiles_huawei?on_conflict=open_id'), {
    method: 'POST',
    headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      open_id: params.openId,
      user_id: params.userId,
      union_id: params.unionId,
      display_name: params.displayName,
      last_login_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const err = await readJson<{ message?: string }>(res);
    throw new Error(
      err?.message ?? `华为账号关联失败（HTTP ${res.status}），请确认 profiles_huawei 迁移已执行`,
    );
  }
}

async function fetchEncryptionProfile(userId: string): Promise<{
  salt: string;
  passwordCheckEnvelope: string;
} | null> {
  const res = await fetch(
    restUrl(`/profiles?id=eq.${userId}&select=salt,password_check_envelope`),
    { headers: serviceHeaders() },
  );
  const rows = await readJson<Array<{ salt: string; password_check_envelope: string }>>(res);
  const row = rows?.[0];
  if (!row?.salt || !row.password_check_envelope) return null;
  return { salt: row.salt, passwordCheckEnvelope: row.password_check_envelope };
}

/**
 * 注销账号：先解除华为 openID 绑定，再硬删除 auth.users。
 *
 * 必须硬删除：软删除会保留 auth.users 行，内部邮箱 `hw_<hash>@...` 仍被占用，
 * 导致同一华为账号重新登录时无法建号。
 */
async function deleteAuthUser(userId: string): Promise<void> {
  // 显式解除 openID 关联（同时兜底 profiles_huawei 未级联的场景）
  await fetch(`${env('SUPABASE_URL')}/rest/v1/profiles_huawei?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  });

  const res = await fetch(
    `${env('SUPABASE_URL')}/auth/v1/admin/users/${userId}?should_soft_delete=false`,
    { method: 'DELETE', headers: serviceHeaders() },
  );
  if (!res.ok) {
    const err = await readJson<{ msg?: string }>(res);
    throw new Error(err?.msg ?? '账号注销失败');
  }
}

/** 校验 App 会话 token，返回用户 id */
async function verifySessionUser(accessToken: string): Promise<string> {
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJson<{ id?: string; msg?: string }>(res);
  if (!res.ok || !body?.id) {
    throw new Error(body?.msg ?? '会话已失效，请重新登录');
  }
  return body.id;
}

/** 邮箱 + 密码校验（GoTrue 密码授权），成功即拿到该账号的真实会话 */
async function verifyEmailPassword(email: string, password: string): Promise<{
  userId: string;
  displayName: string;
  session: SessionTokens;
}> {
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env('SUPABASE_ANON_KEY') },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: { id?: string; user_metadata?: { display_name?: string } };
    error_description?: string;
    msg?: string;
  }>(res);
  if (!res.ok || !body?.access_token || !body.user?.id) {
    throw new Error(body?.error_description ?? body?.msg ?? '邮箱或密码错误');
  }
  return {
    userId: body.user.id,
    displayName: body.user.user_metadata?.display_name?.trim() || email,
    session: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? '',
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    },
  };
}

/** 读取 auth 用户的实际邮箱与昵称（绑定老账号后不再是派生邮箱） */
async function fetchAuthUser(
  userId: string,
): Promise<{ email: string | null; displayName: string | null }> {
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders(),
  });
  if (!res.ok) return { email: null, displayName: null };
  const body = await readJson<{ email?: string; user_metadata?: { display_name?: string } }>(res);
  return {
    email: body?.email ?? null,
    displayName: body?.user_metadata?.display_name ?? null,
  };
}

/** 用 Admin generate_link + verify 交换真实会话（带 refresh token） */
async function issueSession(email: string): Promise<SessionTokens> {
  const anonKey = env('SUPABASE_ANON_KEY');
  const linkRes = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const link = await readJson<{
    hashed_token?: string;
    properties?: { hashed_token?: string };
    msg?: string;
  }>(linkRes);
  const hashedToken = link?.hashed_token ?? link?.properties?.hashed_token;
  if (!linkRes.ok || !hashedToken) {
    throw new Error(link?.msg ?? '会话签发失败');
  }

  const verifyRes = await fetch(`${env('SUPABASE_URL')}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashedToken }),
  });
  const session = await readJson<{
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    msg?: string;
  }>(verifyRes);
  if (!verifyRes.ok || !session?.access_token) {
    throw new Error(session?.msg ?? '会话校验失败');
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token ?? '',
    expiresAt: (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: '仅支持 POST' }, 405);
  }
  if (!env('HUAWEI_CLIENT_ID') || !env('HUAWEI_CLIENT_SECRET')) {
    return json({ error: '华为账号服务未配置（缺少 HUAWEI_CLIENT_ID / HUAWEI_CLIENT_SECRET）' }, 500);
  }

  let payload: RequestBody;
  try {
    payload = (await req.json()) as RequestBody;
  } catch {
    return json({ error: '请求体格式错误' }, 400);
  }

  const code = payload.authorizationCode?.trim() ?? '';
  const state = payload.state?.trim() ?? '';
  const action = payload.action ?? 'login';

  // 注销账号不需要华为授权码
  if (action !== 'delete-account' && (!code || !state)) {
    return json({ error: '缺少 authorizationCode 或 state' }, 400);
  }

  try {
    // ---------- 注销账号：删除服务端账号，释放华为 openID 便于重新登录 ----------
    if (action === 'delete-account') {
      const appToken = payload.accessToken?.trim() ?? '';
      if (!appToken) {
        return json({ error: '缺少会话 accessToken' }, 400);
      }
      let userId: string;
      try {
        userId = await verifySessionUser(appToken);
      } catch {
        return json({ error: '会话已失效，请重新登录' }, 401);
      }
      await deleteAuthUser(userId);
      return json({ ok: true });
    }

    const huaweiToken = await exchangeHuaweiCode(code);
    const userInfo = await fetchHuaweiUserInfo(huaweiToken);
    const openId = userInfo.openid!;
    const huaweiName = userInfo.nickname?.trim() || '华为用户';

    // ---------- 绑定已有邮箱账号：邮箱密码校验通过后关联 openID ----------
    if (action === 'bind') {
      const email = payload.email?.trim().toLowerCase() ?? '';
      const password = payload.password ?? '';
      if (!email || !password) {
        return json({ error: '缺少邮箱或密码' }, 400);
      }
      const bound = await verifyEmailPassword(email, password);

      const linkedUserId = await findUserIdByOpenId(openId);
      if (linkedUserId && linkedUserId !== bound.userId) {
        // 登录时服务端已用该 openID 建了临时账号。若它还没有加密档案，
        // 说明用户尚未完成设置，允许删除临时账号并把 openID 改绑到已有账号。
        const linkedProfile = await fetchEncryptionProfile(linkedUserId);
        if (linkedProfile) {
          return json({ error: '该华为账号已绑定其他账号，请先解绑' }, 409);
        }
        await deleteAuthUser(linkedUserId);
      }

      const profile = await fetchEncryptionProfile(bound.userId);
      if (!profile) {
        return json({ error: '该邮箱账号缺少加密档案，无法绑定' }, 400);
      }

      await linkHuaweiAccount({
        openId,
        unionId: userInfo.unionid ?? null,
        userId: bound.userId,
        displayName: bound.displayName,
      });

      return json({
        accessToken: bound.session.accessToken,
        refreshToken: bound.session.refreshToken,
        expiresAt: bound.session.expiresAt,
        userId: bound.userId,
        email,
        displayName: bound.displayName,
        isNewUser: false,
        hasKeyEnvelope: true,
        profile,
      });
    }

    // ---------- 默认：华为账号登录（建号/关联 + 签发会话） ----------
    let userId = await findUserIdByOpenId(openId);
    const isNewUser = userId === null;
    if (!userId) {
      userId = await createAuthUser(huaweiEmail(openId), huaweiName, openId);
    }

    // 绑定已有邮箱账号后，openID 指向的是老账号，其邮箱不再是华为派生邮箱。
    // 会话必须用账号真实邮箱签发，否则 generate_link 会报 “Email link is invalid or has expired”。
    const existing = isNewUser ? null : await fetchAuthUser(userId);
    const accountEmail = existing?.email ?? huaweiEmail(openId);
    const accountName = existing?.displayName ?? huaweiName;

    await linkHuaweiAccount({
      openId,
      unionId: userInfo.unionid ?? null,
      userId,
      displayName: accountName,
    });

    const profile = await fetchEncryptionProfile(userId);
    const session = await issueSession(accountEmail);

    return json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      userId,
      email: accountEmail,
      displayName: accountName,
      isNewUser,
      hasKeyEnvelope: profile !== null,
      profile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '华为账号登录失败';
    console.error('[huawei-auth]', action, message, payload.deviceId ?? '');
    return json({ error: message }, 500);
  }
});
