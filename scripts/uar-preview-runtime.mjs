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
for (const marker of [
  '🎙 업무수첩',
  'id="mic"',
  'id="save"',
  'id="text"',
  'id="briefingCard"',
  'id="scannerCard"',
  'id="scanGallery"',
  'id="scanCamera"',
  'id="scanGalleryInput"',
  'id="scanCameraInput"',
  'id="scanPdfCard"',
  'id="scannerDialog"'
]) {
  if (!root.body.includes(marker)) throw new Error(`UAR_PREVIEW_RUNTIME_ROOT_MARKER_MISSING:${marker}`);
}

const galleryTag = root.body.match(/<input id="scanGalleryInput"[^>]*>/)?.[0] || '';
const cameraTag = root.body.match(/<input id="scanCameraInput"[^>]*>/)?.[0] || '';
if (!/\bmultiple\b/.test(galleryTag) || /\bcapture=/.test(galleryTag)) {
  throw new Error('UAR_PREVIEW_RUNTIME_SCANNER_GALLERY_CONTRACT_INVALID');
}
if (!/capture="environment"/.test(cameraTag)) {
  throw new Error('UAR_PREVIEW_RUNTIME_SCANNER_CAMERA_CONTRACT_INVALID');
}

const scannerCardTag = root.body.match(/<section id="scannerCard"[^>]*>/)?.[0] || '';
if (!/\bcore-app-card\b/.test(scannerCardTag)) {
  throw new Error('UAR_PREVIEW_RUNTIME_SCANNER_AUTH_VISIBILITY_CONTRACT_MISSING');
}

const assets = [
  '/auth.js',
  '/platform-auth.js',
  '/platform-auth-ui.js',
  '/onboarding.js',
  '/settings.js',
  '/request-id.js',
  '/app.js',
  '/inference-guard.js',
  '/scanner-core.js',
  '/scanner-geometry.js',
  '/scanner.js',
  '/scanner-pdf.js',
  '/quick-save.js',
  '/manual-input.js',
  '/briefing-legacy-loader.js',
  '/briefing.js',
  '/briefing-v2.js',
  '/briefing-v2-expand-state.js',
  '/briefing-edit.js',
  '/kakao.js',
  '/styles.css',
  '/distribution.css',
  '/settings.css',
  '/scanner.css',
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
if (!app.body.includes('fetch("/api/worklog")')) {
  throw new Error('UAR_PREVIEW_RUNTIME_WORKLOG_HEALTH_CALL_MISSING');
}
if (!app.body.includes('navigator.serviceWorker.register("/sw.js")')) {
  throw new Error('UAR_PREVIEW_RUNTIME_SW_REGISTRATION_MISSING');
}

const scanner = await get('/scanner.js');
for (const marker of ['type:"ScanDocument"', 'localOnly:true', 'persistPages', 'navigator.share', 'import("/scanner-pdf.js")']) {
  if (!scanner.body.includes(marker)) throw new Error(`UAR_PREVIEW_RUNTIME_SCANNER_MARKER_MISSING:${marker}`);
}
if (scanner.body.includes('/api/worklog') || /Notion/i.test(scanner.body)) {
  throw new Error('UAR_PREVIEW_RUNTIME_SCANNER_PLATFORM_BOUNDARY_BROKEN');
}

const sw = await get('/sw.js');
for (const asset of ['/scanner.css', '/scanner-core.js', '/scanner-geometry.js', '/scanner.js', '/scanner-pdf.js']) {
  if (!sw.body.includes(`"${asset}"`)) throw new Error(`UAR_PREVIEW_RUNTIME_SCANNER_OFFLINE_ASSET_MISSING:${asset}`);
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

console.log(`UAR_PREVIEW_RUNTIME_PASS ${previewUrl} assets=${assets.length} scanner=true`);
