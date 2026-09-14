const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (!previewUrl) throw new Error('UAR_ENV_PREVIEW_URL_MISSING');

const base = new URL(previewUrl);
if (base.protocol !== 'https:') throw new Error('UAR_ENV_HTTPS_REQUIRED');
if (!base.hostname.includes('deploy-preview-')) {
  throw new Error(`UAR_ENV_NOT_DEPLOY_PREVIEW:${base.hostname}`);
}

async function get(pathname, options = {}) {
  const url = new URL(pathname, `${previewUrl}/`).toString();
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store', ...options });
  const text = await response.text();
  return { response, text, url };
}

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
if (healthJson?.ok !== true || healthJson?.configured !== true) {
  throw new Error(`UAR_ENV_WORKLOG_NOT_CONFIGURED:${JSON.stringify({ ok: healthJson?.ok, configured: healthJson?.configured, mode: healthJson?.mode })}`);
}

const briefing = await get('/api/briefing-v2');
if (briefing.response.status === 404 || briefing.response.status >= 500) {
  throw new Error(`UAR_ENV_BRIEFING_ROUTE_BAD_STATUS:${briefing.response.status}`);
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

console.log(`UAR_ENVIRONMENT_PARITY_PASS preview=${base.hostname} worklog_mode=${healthJson.mode || 'unknown'} briefing_status=${briefing.response.status}`);
