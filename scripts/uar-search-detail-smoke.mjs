import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previewUrl = String(process.env.PREVIEW_URL || '').replace(/\/$/, '');
if (!previewUrl) throw new Error('UAR_SEARCH_DETAIL_PREVIEW_URL_MISSING');

const parsed = new URL(previewUrl);
if (parsed.protocol !== 'https:' || !parsed.hostname.includes('deploy-preview-')) {
  throw new Error(`UAR_SEARCH_DETAIL_NOT_DEPLOY_PREVIEW:${parsed.hostname}`);
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
  throw new Error('UAR_SEARCH_DETAIL_CHROME_NOT_FOUND');
}

async function fetchPreviewHtml() {
  const response = await fetch(`${previewUrl}/`, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok) throw new Error(`UAR_SEARCH_DETAIL_PREVIEW_ROOT_HTTP_${response.status}`);
  const html = await response.text();
  for (const marker of ['id="mic"', 'id="text"', 'main-ui-state.js']) {
    if (!html.includes(marker)) throw new Error(`UAR_SEARCH_DETAIL_ROOT_CONTRACT_MISSING:${marker}`);
  }
  return html;
}

const recordId = '11111111-1111-4111-8111-111111111111';
const browserStub = `<script>
(() => {
  window.__uarXssExecuted = false;
  const recordId = ${JSON.stringify(recordId)};
  const fakeSession = { access_token: 'uar-access-token', refresh_token: 'uar-refresh-token' };
  try {
    localStorage.setItem('worklogSupabaseSessionV1', JSON.stringify(fakeSession));
  } catch {}

  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  }));
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : String(input && input.url || '');
    if (raw.includes('/api/supabase-auth-config')) {
      return json({
        configured: true,
        supabaseUrl: 'https://uar.supabase.test',
        publishableKey: 'sb_publishable_uar',
        dataCorePrimaryEnabled: true,
      });
    }
    if (raw.includes('/rest/v1/rpc/search_my_work_records')) {
      return json([{
        work_record_id: recordId,
        workspace_id: '22222222-2222-4222-8222-222222222222',
        workspace_name: '내 업무',
        title: '태장 월세 입금 확인',
        snippet: '태장 월세 입금 확인 상세 내용',
        institution: '',
        record_type: 'task',
        status: 'completed',
        recorded_at: '2026-09-16T09:00:00Z',
        due_at: '2026-09-17T09:00:00Z',
        match_type: 'partial',
        match_rank: 1
      }]);
    }
    if (raw.includes('/rest/v1/work_records')) {
      return json([{
        id: recordId,
        title: '태장 월세 입금 확인',
        content: '<img src=x onerror="window.__uarXssExecuted=true"> 기록 내용',
        original_text: '원문 태장 월세 입금 확인',
        record_type: 'task',
        status: 'completed',
        institution: '태장',
        amount: 1500000,
        follow_up: '입금증 확인',
        recorded_at: '2026-09-16T09:00:00Z',
        due_at: '2026-09-17T09:00:00Z',
        metadata: { fieldProvenance: { institution: 'user_confirmed' } }
      }]);
    }
    if (/\/auth\/v1\/user(?:\?|$)/.test(raw)) {
      return json({ id: 'uar-user', email: 'uar@example.test' });
    }
    if (/\/auth\/v1\/token\?grant_type=refresh_token/.test(raw)) {
      return json(fakeSession);
    }
    if (raw.startsWith('/api/briefing') || raw.startsWith('/api/kakao')) {
      return json({ error: 'Deploy Preview owner integrations are intentionally isolated.' }, 500);
    }
    if (raw.startsWith('/api/')) {
      return json({ error: 'UAR search detail smoke blocks external writes.' }, 503);
    }
    return json({ error: 'UAR search detail smoke blocks network fetches.' }, 503);
  };
})();
</script>`;

const interaction = `<script>
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (check, label, timeout = 7000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const value = check();
        if (value) return value;
      } catch {}
      await sleep(50);
    }
    throw new Error('timeout:' + label);
  };
  const fail = (error) => {
    document.documentElement.setAttribute('data-uar-search-detail', 'fail');
    const marker = document.createElement('pre');
    marker.id = 'uarSearchDetailFailure';
    marker.textContent = String(error && error.message || error || 'unknown');
    document.body.append(marker);
  };

  window.addEventListener('load', async () => {
    try {
      const open = await waitFor(() => {
        const node = document.getElementById('worklogSearchOpen');
        return node && !node.hidden ? node : null;
      }, 'search-open');
      open.click();

      const screen = await waitFor(() => {
        const node = document.getElementById('searchScreen');
        return node && !node.hidden ? node : null;
      }, 'search-screen');
      const input = document.getElementById('worklogSearchInput');
      const form = document.getElementById('worklogSearchForm');
      if (!input || !form) throw new Error('search-form-missing');
      input.value = '태장';
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      const item = await waitFor(
        () => document.querySelector('.search-result[data-work-record-id="${recordId}"]'),
        'search-result'
      );
      if (item.getAttribute('role') !== 'button' || item.tabIndex !== 0) throw new Error('result-a11y-missing');
      await waitFor(() => window.WorklogSearchDetail && typeof window.WorklogSearchDetail.open === 'function', 'detail-module');

      item.click();
      const panel = await waitFor(() => {
        const node = document.getElementById('worklogSearchDetail');
        const card = document.getElementById('worklogSearchDetailCard');
        return node && !node.hidden && card && !card.hidden ? node : null;
      }, 'detail-panel');
      if (!panel.textContent.includes('태장 월세 입금 확인')) throw new Error('detail-title-missing');
      if (!panel.textContent.includes('입금증 확인')) throw new Error('detail-follow-up-missing');
      if (!panel.textContent.includes('태장')) throw new Error('trusted-institution-missing');
      if (window.__uarXssExecuted) throw new Error('detail-xss-executed');

      document.getElementById('worklogSearchDetailClose').click();
      await waitFor(() => panel.hidden && !screen.hidden, 'detail-back');

      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await waitFor(() => !panel.hidden, 'detail-keyboard-open');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await waitFor(() => panel.hidden && !screen.hidden, 'detail-escape-close');

      document.documentElement.setAttribute('data-uar-search-detail', 'pass');
      const marker = document.createElement('div');
      marker.id = 'uarSearchDetailPass';
      marker.textContent = 'SEARCH_DETAIL_INTERACTION_PASS';
      document.body.append(marker);
    } catch (error) {
      fail(error);
    }
  }, { once: true });
})();
</script>`;

let html = await fetchPreviewHtml();
html = html.replace(/<head>/i, `<head><base href="${previewUrl}/">${browserStub}`);
html = html.replace(/\b(src|href)=(["'])(\/[^"']+)\2/g, (_match, attr, quote, resource) => {
  return `${attr}=${quote}${previewUrl}${resource}${quote}`;
});
html = html.replace(/<\/body>/i, `${interaction}</body>`);

const temp = mkdtempSync(join(tmpdir(), 'worklog-uar-search-detail-'));
const fixturePath = join(temp, 'preview-search-detail.html');
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
    '--virtual-time-budget=12000',
    '--dump-dom',
    `file://${fixturePath}`,
  ], {
    encoding: 'utf8',
    timeout: 35000,
    maxBuffer: 12 * 1024 * 1024,
  });
} finally {
  // stdout is retained by spawnSync before cleanup.
}

const dom = String(result?.stdout || '');
const stderr = String(result?.stderr || '');
rmSync(temp, { recursive: true, force: true });

if (result?.error && !dom.trim()) {
  throw new Error(`UAR_SEARCH_DETAIL_CHROME_FAILED:${String(result.error.message || result.error).slice(0, 1000)}:${stderr.slice(-1000)}`);
}
if (!dom.trim()) throw new Error(`UAR_SEARCH_DETAIL_EMPTY_DOM:${stderr.slice(-1000)}`);
if (!dom.includes('data-uar-search-detail="pass"') || !dom.includes('SEARCH_DETAIL_INTERACTION_PASS')) {
  const failure = dom.match(/id="uarSearchDetailFailure"[^>]*>([^<]*)</)?.[1] || 'missing-pass-marker';
  throw new Error(`UAR_SEARCH_DETAIL_INTERACTION_FAILED:${failure}:${stderr.slice(-700)}`);
}
if (dom.includes('data-uar-search-detail="fail"')) throw new Error('UAR_SEARCH_DETAIL_FAIL_MARKER_PRESENT');

console.log(`UAR_SEARCH_DETAIL_SMOKE_PASS chrome=${chrome} tap=true keyboard=true back=true escape=true rls_fetch=single-record xss=safe`);
