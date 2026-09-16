const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (!previewUrl) throw new Error('UAR_PREVIEW_RUNTIME_URL_MISSING');

const base = new URL(previewUrl);
if (base.protocol !== 'https:') throw new Error('UAR_PREVIEW_RUNTIME_HTTPS_REQUIRED');
if (!base.hostname.includes('deploy-preview-')) {
  throw new Error(`UAR_PREVIEW_RUNTIME_NOT_PREVIEW:${base.hostname}`);
}

async function get(pathname) {
  const url = new URL(pathname, `${previewUrl}/`).toString();
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`UAR_PREVIEW_RUNTIME_HTTP_${response.status}:${pathname}`);
  }
  return { response, body, url };
}

const root = await get('/');
for (const marker of ['🎙 업무수첩', 'id="mic"', 'id="save"', 'id="text"', 'id="briefingCard"']) {
  if (!root.body.includes(marker)) throw new Error(`UAR_PREVIEW_RUNTIME_ROOT_MARKER_MISSING:${marker}`);
}

const assets = [
  '/auth.js',
  '/onboarding.js',
  '/request-id.js',
  '/app.js',
  '/inference-guard.js',
  '/quick-save.js',
  '/manual-input.js',
  '/briefing.js',
  '/briefing-v2.js',
  '/briefing-v2-expand-state.js',
  '/briefing-edit.js',
  '/kakao.js',
  '/styles.css',
  '/briefing.css',
  '/briefing-edit.css',
  '/manifest.webmanifest',
  '/sw.js'
];

for (const asset of assets) {
  const result = await get(asset);
  if (!result.body.trim()) throw new Error(`UAR_PREVIEW_RUNTIME_EMPTY_ASSET:${asset}`);
  if (/Page not found|Not Found/i.test(result.body.slice(0, 500)) && asset !== '/briefing-edit.css') {
    throw new Error(`UAR_PREVIEW_RUNTIME_NOT_FOUND_BODY:${asset}`);
  }
}

const app = await get('/app.js');
if (app.body.includes('fetch("/api/worklog")')) {
  throw new Error('UAR_PREVIEW_RUNTIME_STARTUP_WORKLOG_HEALTH_CALL_FORBIDDEN');
}
if (!app.body.includes('worklog:platform-auth-changed') || !app.body.includes('WorklogPlatformAuth?.readSession?.()')) {
  throw new Error('UAR_PREVIEW_RUNTIME_LOCAL_AUTH_HEALTH_STATE_MISSING');
}
if (!app.body.includes('navigator.serviceWorker.register("/sw.js")')) {
  throw new Error('UAR_PREVIEW_RUNTIME_SW_REGISTRATION_MISSING');
}

const setup = await get('/setup.html');
if (!setup.body.includes('Notion') || !setup.body.includes('업무수첩')) {
  throw new Error('UAR_PREVIEW_RUNTIME_SETUP_SURFACE_MISSING');
}

if (String(process.env.GITHUB_HEAD_REF || '').trim() === 'goal/platform-v1') {
  const authConfig = await get('/api/supabase-auth-config');
  let config;
  try {
    config = JSON.parse(authConfig.body);
  } catch {
    throw new Error('UAR_PREVIEW_RUNTIME_DATA_CORE_CONFIG_INVALID_JSON');
  }
  if (config?.configured !== true) {
    throw new Error('UAR_PREVIEW_RUNTIME_DATA_CORE_NOT_CONFIGURED');
  }
  if (config?.dataCorePrimaryEnabled !== true) {
    throw new Error('UAR_PREVIEW_RUNTIME_DATA_CORE_PRIMARY_DISABLED');
  }
  if (!/^https:\/\//.test(String(config?.supabaseUrl || ''))) {
    throw new Error('UAR_PREVIEW_RUNTIME_DATA_CORE_URL_INVALID');
  }
  if (!String(config?.publishableKey || '').startsWith('sb_publishable_')) {
    throw new Error('UAR_PREVIEW_RUNTIME_DATA_CORE_PUBLISHABLE_KEY_INVALID');
  }
  for (const forbidden of ['secret', 'serviceRole', 'service_role', 'serviceRoleKey', 'service_role_key']) {
    if (Object.prototype.hasOwnProperty.call(config, forbidden)) {
      throw new Error(`UAR_PREVIEW_RUNTIME_SECRET_FIELD_EXPOSED:${forbidden}`);
    }
  }
  console.log('UAR_PREVIEW_RUNTIME_DATA_CORE_CONFIG_PASS');
}

console.log(`UAR_PREVIEW_RUNTIME_PASS ${previewUrl} assets=${assets.length}`);
