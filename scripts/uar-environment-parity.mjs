const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (!previewUrl) throw new Error('UAR_ENV_PREVIEW_URL_MISSING');

const base = new URL(previewUrl);
if (base.protocol !== 'https:') throw new Error('UAR_ENV_HTTPS_REQUIRED');
if (!base.hostname.includes('deploy-preview-')) {
  throw new Error(`UAR_ENV_NOT_DEPLOY_PREVIEW:${base.hostname}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(pathname, options = {}) {
  const url = new URL(pathname, `${previewUrl}/`).toString();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', cache: 'no-store', ...options });
      const text = await response.text();
      return { response, text, url };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(400 * attempt);
    }
  }
  throw new Error(`UAR_ENV_NETWORK_RETRY_EXHAUSTED:${pathname}:${String(lastError?.cause?.code || lastError?.message || lastError)}`);
}

// Deploy Preview intentionally does not receive the Production Notion token.
// The safe contract is therefore: route works, response is valid, and owner mode
// reports "configured: false" instead of leaking/using Production credentials.
const health = await get('/api/worklog');
if (!health.response.ok) {
  throw new Error(`UAR_ENV_WORKLOG_HEALTH_HTTP_${health.response.status}`);
}
let healthJson;
try {
  healthJson = JSON.parse(health.text);
} catch {
  throw new Error('UAR_ENV_WORKLOG_HEALTH_INVALID_JSON');
}
if (healthJson?.ok !== true || healthJson?.mode !== 'owner') {
  throw new Error(`UAR_ENV_WORKLOG_HEALTH_CONTRACT_BAD:${JSON.stringify({ ok: healthJson?.ok, mode: healthJson?.mode })}`);
}
if (healthJson?.configured !== false) {
  throw new Error(`UAR_ENV_PREVIEW_PRODUCTION_SECRET_BOUNDARY_BROKEN:${JSON.stringify({ configured: healthJson?.configured, mode: healthJson?.mode })}`);
}

// Briefing-v2 is expected to be present but unable to use owner Notion data in a
// secret-isolated Preview. 401 (if an access-key gate is reached) or 500 (missing
// Preview-only Notion token) are both safe fail-closed states; 404 means the route
// is missing and 2xx would mean the Preview unexpectedly has owner data access.
const briefing = await get('/api/briefing-v2');
if (briefing.response.status === 404) {
  throw new Error('UAR_ENV_BRIEFING_ROUTE_MISSING');
}
if (briefing.response.ok) {
  throw new Error(`UAR_ENV_PREVIEW_BRIEFING_UNEXPECTED_OWNER_ACCESS:${briefing.response.status}`);
}
if (![401, 500].includes(briefing.response.status)) {
  throw new Error(`UAR_ENV_BRIEFING_UNEXPECTED_STATUS:${briefing.response.status}`);
}
try {
  const briefingJson = JSON.parse(briefing.text);
  if (!String(briefingJson?.error || '').trim()) {
    throw new Error('missing safe error');
  }
} catch {
  throw new Error('UAR_ENV_BRIEFING_ERROR_RESPONSE_INVALID');
}

// Server Push must validate the real Deploy Preview runtime secret, not only a
// synthetic unit-test key. The GET endpoint derives the public VAPID key from the
// private Netlify secret, so a malformed/missing private key fails this gate before
// a user is ever asked to test on a phone.
const pushConfig = await get('/api/push-subscription');
if (!pushConfig.response.ok) {
  throw new Error(`UAR_ENV_PUSH_CONFIG_HTTP_${pushConfig.response.status}`);
}
let pushJson;
try {
  pushJson = JSON.parse(pushConfig.text);
} catch {
  throw new Error('UAR_ENV_PUSH_CONFIG_INVALID_JSON');
}
if (pushJson?.configured !== true) {
  throw new Error(`UAR_ENV_PUSH_NOT_CONFIGURED:${JSON.stringify({ configured: pushJson?.configured })}`);
}
const vapidPublicKey = String(pushJson?.publicKey || '');
if (!/^[A-Za-z0-9_-]{80,100}$/.test(vapidPublicKey)) {
  throw new Error('UAR_ENV_PUSH_PUBLIC_KEY_INVALID');
}
for (const forbidden of ['privateKey', 'private_key', 'WEB_PUSH_VAPID_PRIVATE_KEY']) {
  if (Object.prototype.hasOwnProperty.call(pushJson, forbidden) || pushConfig.text.includes(forbidden)) {
    throw new Error(`UAR_ENV_PUSH_PRIVATE_KEY_LEAK:${forbidden}`);
  }
}

const manifest = await get('/manifest.webmanifest');
if (!manifest.response.ok) throw new Error(`UAR_ENV_MANIFEST_HTTP_${manifest.response.status}`);
let manifestJson;
try {
  manifestJson = JSON.parse(manifest.text);
} catch {
  throw new Error('UAR_ENV_MANIFEST_INVALID_JSON');
}
if (!String(manifestJson?.name || manifestJson?.short_name || '').trim()) {
  throw new Error('UAR_ENV_MANIFEST_NAME_MISSING');
}

const sw = await get('/sw.js');
if (!sw.response.ok) throw new Error(`UAR_ENV_SW_HTTP_${sw.response.status}`);
for (const asset of ['/index.html', '/app.js', '/manifest.webmanifest']) {
  if (!sw.text.includes(`"${asset}"`)) {
    throw new Error(`UAR_ENV_SW_ASSET_MISSING:${asset}`);
  }
}

const robots = String((await get('/')).response.headers.get('x-robots-tag') || '').toLowerCase();
if (!robots.includes('noindex')) {
  throw new Error(`UAR_ENV_NOINDEX_HEADER_MISSING:${robots}`);
}

console.log(`UAR_ENVIRONMENT_PARITY_PASS preview=${base.hostname} owner_secret_isolated=true push_configured=true briefing_status=${briefing.response.status}`);
