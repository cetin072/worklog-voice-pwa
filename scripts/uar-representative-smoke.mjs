import { execFileSync } from 'node:child_process';

const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (!previewUrl) throw new Error('UAR_SMOKE_PREVIEW_URL_MISSING');

const parsed = new URL(previewUrl);
if (!parsed.hostname.includes('deploy-preview-')) {
  throw new Error(`UAR_SMOKE_NOT_DEPLOY_PREVIEW:${parsed.hostname}`);
}

function findChrome() {
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const path = execFileSync('sh', ['-lc', `command -v ${candidate}`], { encoding: 'utf8' }).trim();
      if (path) return path;
    } catch {}
  }
  throw new Error('UAR_SMOKE_CHROME_NOT_FOUND');
}

const chrome = findChrome();
let dom;
try {
  dom = execFileSync(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--virtual-time-budget=7000',
    '--dump-dom',
    `${previewUrl}/`
  ], {
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024
  });
} catch (error) {
  const stderr = String(error?.stderr || '').slice(-2000);
  throw new Error(`UAR_SMOKE_CHROME_FAILED:${stderr}`);
}

for (const marker of ['id="mic"', 'id="save"', 'id="manualEntry"', 'id="text"', 'id="typedSave"', 'id="briefingCard"']) {
  if (!dom.includes(marker)) throw new Error(`UAR_SMOKE_CORE_CONTROL_MISSING:${marker}`);
}

if (!/id="health"[^>]*>\s*연결됨\s*</.test(dom)) {
  const health = dom.match(/id="health"[^>]*>([^<]*)</)?.[1]?.trim() || 'missing';
  throw new Error(`UAR_SMOKE_HEALTH_NOT_CONNECTED:${health}`);
}

if (/Page not found|Site not found|Application Error/i.test(dom)) {
  throw new Error('UAR_SMOKE_FATAL_PAGE_ERROR_VISIBLE');
}

console.log(`UAR_REPRESENTATIVE_SMOKE_PASS chrome=${chrome} health=연결됨`);
