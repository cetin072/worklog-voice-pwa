/** No storage or logging: a confidential-client token exchange for a logged-in
 * app owner. Destinations and OAuth client identity come only from server config. */
export function createGoogleRefreshHandler({ env, fetchImpl = fetch }) {
  const json = (status, body) => new Response(JSON.stringify(body), { status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'pragma': 'no-cache' } });
  return async request => {
    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
    const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1];
    if (!bearer) return json(401, { error: 'CALENDAR_APP_LOGIN_REQUIRED' });
    const url = env('SUPABASE_URL'), key = env('SUPABASE_PUBLISHABLE_KEY');
    const clientId = env('GOOGLE_CALENDAR_CLIENT_ID'), secret = env('GOOGLE_CALENDAR_CLIENT_SECRET');
    if (!url || !key || !clientId || !secret) return json(503, { error: 'CALENDAR_REFRESH_NOT_CONFIGURED' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const call = (url, init) => fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
    try {
      const text = await request.text();
      if (text.length > 8192) return json(413, { error: 'INVALID_REQUEST' });
      let body; try { body = JSON.parse(text); } catch { return json(400, { error: 'INVALID_REQUEST' }); }
      if (!body || ['ownerId', 'accountId', 'refreshToken'].some(k => typeof body[k] !== 'string' || !body[k] || body[k].length > 4096)) return json(400, { error: 'INVALID_REQUEST' });
      const auth = await call(`${url.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${bearer}` } });
      if (!auth.ok) return json(auth.status >= 500 ? 502 : 401, { error: auth.status >= 500 ? 'CALENDAR_REFRESH_FAILED' : 'CALENDAR_APP_LOGIN_REQUIRED' });
      const user = await auth.json();
      if (!user.id || user.id !== body.ownerId) return json(401, { error: 'CALENDAR_APP_LOGIN_REQUIRED' });
      const token = await call('https://oauth2.googleapis.com/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: body.refreshToken, client_id: clientId, client_secret: secret }).toString() });
      const grant = await token.json();
      if (!token.ok) return json(grant.error === 'invalid_grant' ? 409 : 502,
        { error: grant.error === 'invalid_grant' ? 'CALENDAR_REAUTH_REQUIRED' : 'CALENDAR_REFRESH_FAILED' });
      if (typeof grant.access_token !== 'string' || !grant.access_token || !Number.isFinite(grant.expires_in) || grant.expires_in <= 60) return json(502, { error: 'CALENDAR_REFRESH_FAILED' });
      const identity = await call('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${grant.access_token}` } });
      if (!identity.ok) return json(502, { error: 'CALENDAR_REFRESH_FAILED' });
      const account = await identity.json();
      if (account.id !== body.accountId || account.verified_email !== true) return json(409, { error: 'CALENDAR_REAUTH_REQUIRED' });
      return json(200, { accessToken: grant.access_token, expiresIn: grant.expires_in, accountId: account.id,
        ...(typeof grant.refresh_token === 'string' && grant.refresh_token ? { refreshToken: grant.refresh_token } : {}) });
    } catch { return json(502, { error: 'CALENDAR_REFRESH_FAILED' }); }
    finally { clearTimeout(timer); }
  };
}
