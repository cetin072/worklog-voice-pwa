import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (!previewUrl) throw new Error('UAR_SMOKE_PREVIEW_URL_MISSING');

const parsed = new URL(previewUrl);
if (!parsed.hostname.includes('deploy-preview-')) {
  throw new Error(`UAR_SMOKE_NOT_DEPLOY_PREVIEW:${parsed.hostname}`);
}

function findChrome() {
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'];
    for (const root of roots.filter(Boolean)) {
      const candidate = join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const path = execFileSync('sh', ['-lc', `command -v ${candidate}`], { encoding: 'utf8' }).trim();
      if (path) return path;
    } catch {}
  }
  throw new Error('UAR_SMOKE_CHROME_NOT_FOUND');
}

async function fetchPreviewHtml() {
  const response = await fetch(`${previewUrl}/`, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok) throw new Error(`UAR_SMOKE_PREVIEW_ROOT_HTTP_${response.status}`);
  const html = await response.text();
  for (const marker of ['id="mic"', 'id="text"', 'id="scannerCard"', 'id="scanGallery"', 'id="scanCamera"']) {
    if (!html.includes(marker)) throw new Error(`UAR_SMOKE_PREVIEW_ROOT_CONTRACT_MISSING:${marker}`);
  }
  return html;
}

const browserStub = `<script>
(() => {
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  }));
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : String(input && input.url || '');
    const method = String(init.method || 'GET').toUpperCase();
    if (raw === '/api/worklog' && method === 'GET') {
      return json({ ok: true, configured: false, mode: 'owner' });
    }
    if (raw.startsWith('/api/briefing') || raw.startsWith('/api/kakao')) {
      return json({ error: 'Deploy Preview owner integrations are intentionally isolated.' }, 500);
    }
    if (raw.startsWith('/api/')) {
      return json({ error: 'UAR smoke blocks external writes.' }, 503);
    }
    return json({ error: 'UAR smoke blocks network fetches.' }, 503);
  };
  HTMLInputElement.prototype.click = function () {
    this.dataset.uarClickCount = String(Number(this.dataset.uarClickCount || 0) + 1);
  };
  window.prompt = () => '';
  window.alert = () => {};
  window.confirm = () => false;
})();
</script>`;

const scannerProbe = `<script>
(() => {
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const gallery = document.getElementById('scanGallery');
      const camera = document.getElementById('scanCamera');
      const addGallery = document.getElementById('scanPdfAddGallery');
      const addCamera = document.getElementById('scanPdfAddCamera');
      const galleryInput = document.getElementById('scanGalleryInput');
      const cameraInput = document.getElementById('scanCameraInput');
      gallery?.click();
      camera?.click();
      addGallery?.click();
      addCamera?.click();
      const apiReady = Boolean(window.WorklogScanner && typeof window.WorklogScanner.pageCount === 'function' && typeof window.WorklogScanner.getDocument === 'function');
      const inputContract = Boolean(galleryInput?.multiple && !galleryInput?.hasAttribute('capture') && cameraInput?.getAttribute('capture') === 'environment');
      const authContract = Boolean(document.getElementById('scannerCard')?.classList.contains('core-app-card'));
      const wiringReady = Number(galleryInput?.dataset.uarClickCount || 0) === 2 && Number(cameraInput?.dataset.uarClickCount || 0) === 2;
      const node = document.createElement('div');
      node.id = 'uarScannerSmokeResult';
      node.dataset.result = apiReady && inputContract && authContract && wiringReady ? 'PASS' : 'FAIL';
      node.dataset.detail = `api:${apiReady};inputs:${inputContract};auth:${authContract};wiring:${wiringReady}`;
      node.hidden = true;
      document.body.append(node);
    }, 2200);
  }, { once: true });
})();
</script>`;

let html = await fetchPreviewHtml();
html = html.replace(/(<script\b)/i, `${browserStub}${scannerProbe}$1`);
html = html.replace(/\b(src|href)=(["'])(\/[^"']+)\2/g, (_match, attr, quote, resource) => {
  return `${attr}=${quote}${previewUrl}${resource}${quote}`;
});

const temp = mkdtempSync(join(tmpdir(), 'worklog-uar-'));
const fixturePath = join(temp, 'preview-fixture.html');
writeFileSync(fixturePath, html, 'utf8');

const chrome = findChrome();
let result;
try {
  result = spawnSync(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=PushMessaging,Notifications,BackgroundFetch,PeriodicBackgroundSync,OptimizationHints,MediaRouter',
    '--allow-file-access-from-files',
    '--virtual-time-budget=6500',
    '--dump-dom',
    `file://${fixturePath}`
  ], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024
  });
} finally {
  // Read stdout before cleanup; spawnSync keeps it in memory.
}

const dom = String(result?.stdout || '');
const stderr = String(result?.stderr || '');
rmSync(temp, { recursive: true, force: true });

if (result?.error && !dom.trim()) {
  throw new Error(`UAR_SMOKE_CHROME_FAILED:${String(result.error.message || result.error).slice(0, 1000)}:${stderr.slice(-1000)}`);
}
if (!dom.trim()) {
  throw new Error(`UAR_SMOKE_EMPTY_DOM:${stderr.slice(-1000)}`);
}

for (const marker of [
  'id="mic"',
  'id="save"',
  'id="manualEntry"',
  'id="text"',
  'id="typedSave"',
  'id="briefingCard"',
  'id="scannerCard"',
  'id="scanGallery"',
  'id="scanCamera"',
  'id="scanPdfCard"',
  'id="scannerDialog"'
]) {
  if (!dom.includes(marker)) throw new Error(`UAR_SMOKE_CORE_CONTROL_MISSING:${marker}`);
}

const scannerMarker = dom.match(/id="uarScannerSmokeResult"[^>]*data-result="([^"]+)"[^>]*data-detail="([^"]*)"/);
if (!scannerMarker) throw new Error('UAR_SMOKE_SCANNER_RESULT_MISSING');
if (scannerMarker[1] !== 'PASS') throw new Error(`UAR_SMOKE_SCANNER_FAILED:${scannerMarker[2]}`);

if (!/id="health"[^>]*>\s*설정 필요\s*</.test(dom)) {
  const health = dom.match(/id="health"[^>]*>([^<]*)</)?.[1]?.trim() || 'missing';
  throw new Error(`UAR_SMOKE_HEALTH_SAFE_STATE_MISSING:${health}`);
}

if (/Page not found|Site not found|Application Error/i.test(dom)) {
  throw new Error('UAR_SMOKE_FATAL_PAGE_ERROR_VISIBLE');
}

for (const asset of ['/app.js', '/scanner-core.js', '/scanner-geometry.js', '/scanner.js']) {
  if (!dom.includes(`${previewUrl}${asset}`)) throw new Error(`UAR_SMOKE_PREVIEW_ASSET_SOURCE_MISSING:${asset}`);
}

console.log(`UAR_REPRESENTATIVE_SMOKE_PASS chrome=${chrome} preview_assets=true external_writes=false scanner=${scannerMarker[2]} health=설정 필요`);
