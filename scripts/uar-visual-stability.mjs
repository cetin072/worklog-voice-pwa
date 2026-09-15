import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (!previewUrl) throw new Error('UAR_VISUAL_PREVIEW_URL_MISSING');

const parsed = new URL(previewUrl);
if (!parsed.hostname.includes('deploy-preview-')) {
  throw new Error(`UAR_VISUAL_NOT_DEPLOY_PREVIEW:${parsed.hostname}`);
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
  throw new Error('UAR_VISUAL_CHROME_NOT_FOUND');
}

async function fetchPreviewHtml() {
  const response = await fetch(`${previewUrl}/`, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok) throw new Error(`UAR_VISUAL_PREVIEW_ROOT_HTTP_${response.status}`);
  const html = await response.text();
  for (const marker of ['id="mic"', 'id="save"', 'id="scannerCard"', 'id="scanGallery"', 'id="scanCamera"', 'id="briefingCard"', 'id="entryCard"', 'id="text"']) {
    if (!html.includes(marker)) throw new Error(`UAR_VISUAL_PREVIEW_CONTRACT_MISSING:${marker}`);
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
    if (raw === '/api/worklog' && method === 'GET') return json({ ok: true, configured: false, mode: 'owner' });
    if (raw.startsWith('/api/briefing') || raw.startsWith('/api/kakao')) {
      return json({ error: 'Deploy Preview owner integrations are intentionally isolated.' }, 500);
    }
    if (raw.startsWith('/api/')) return json({ error: 'UAR visual gate blocks external writes.' }, 503);
    return json({ error: 'UAR visual gate blocks network fetches.' }, 503);
  };
  window.prompt = () => '';
  window.alert = () => {};
  window.confirm = () => false;
})();
</script>`;

const probe = `<script>
(() => {
  const selectors = ['#mic','#save','#manualEntry','#scannerCard','#scanGallery','#scanCamera','#briefingCard','#entryCard','#text','#typedSave'];
  const round = value => Math.round(value * 10) / 10;
  const snapshot = () => ({
    viewport: [window.innerWidth, window.innerHeight],
    scrollHeight: document.documentElement.scrollHeight,
    nodes: Object.fromEntries(selectors.map(selector => {
      const node = document.querySelector(selector);
      if (!node) return [selector, null];
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return [selector, {
        x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height),
        display: style.display, visibility: style.visibility, opacity: style.opacity
      }];
    }))
  });
  const finish = (result, detail) => {
    const node = document.createElement('div');
    node.id = 'uarVisualStabilityResult';
    node.dataset.result = result;
    node.dataset.detail = detail;
    node.hidden = true;
    document.body.append(node);
  };
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const samples = [];
      let count = 0;
      const timer = setInterval(() => {
        samples.push(snapshot());
        count += 1;
        if (count < 8) return;
        clearInterval(timer);
        const serialized = samples.map(item => JSON.stringify(item));
        const first = serialized[0];
        const stable = serialized.every(item => item === first);
        const missing = Object.entries(samples[0].nodes).filter(([, value]) => !value).map(([key]) => key);
        if (missing.length) return finish('FAIL', 'missing:' + missing.join(','));
        if (!stable) {
          const changed = serialized.findIndex(item => item !== first);
          return finish('FAIL', 'sample_changed_at:' + changed);
        }
        finish('PASS', 'samples:8;viewport:mobile;geometry:stable;scanner:included');
      }, 250);
    }, 1800);
  }, { once: true });
})();
</script>`;

let html = await fetchPreviewHtml();
html = html.replace(/(<script\b)/i, `${browserStub}${probe}$1`);
html = html.replace(/\b(src|href)=(["'])(\/[^"']+)\2/g, (_match, attr, quote, resource) => {
  return `${attr}=${quote}${previewUrl}${resource}${quote}`;
});

const temp = mkdtempSync(join(tmpdir(), 'worklog-uar-visual-'));
const fixturePath = join(temp, 'preview-visual-fixture.html');
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
    '--window-size=412,915',
    '--virtual-time-budget=6500',
    '--dump-dom',
    `file://${fixturePath}`
  ], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024
  });
} finally {
  // cleanup below after stdout has been captured by spawnSync
}

const dom = String(result?.stdout || '');
const stderr = String(result?.stderr || '');
rmSync(temp, { recursive: true, force: true });

if (result?.error && !dom.trim()) {
  throw new Error(`UAR_VISUAL_CHROME_FAILED:${String(result.error.message || result.error).slice(0, 1000)}:${stderr.slice(-1000)}`);
}
if (!dom.trim()) throw new Error(`UAR_VISUAL_EMPTY_DOM:${stderr.slice(-1000)}`);

const marker = dom.match(/id="uarVisualStabilityResult"[^>]*data-result="([^"]+)"[^>]*data-detail="([^"]*)"/);
if (!marker) throw new Error('UAR_VISUAL_RESULT_MISSING');
if (marker[1] !== 'PASS') throw new Error(`UAR_VISUAL_STABILITY_FAILED:${marker[2]}`);

for (const asset of ['/app.js', '/scanner.js', '/scanner.css']) {
  if (!dom.includes(`${previewUrl}${asset}`)) throw new Error(`UAR_VISUAL_PREVIEW_ASSET_SOURCE_MISSING:${asset}`);
}

console.log(`UAR_VISUAL_STABILITY_PASS chrome=${chrome} ${marker[2]} preview_assets=true external_writes=false`);
