import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const indexPath = path.join(root, 'public', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

const requiredIds = [
  'health',
  'homeBriefingCard',
  'homeBriefingTodayCount',
  'homeBriefingOverdueCount',
  'homeBriefingFollowUpCount',
  'homeBriefingNextSchedule',
  'homeBriefingOpen',
  'mic',
  'micText',
  'save',
  'manualEntry',
  'clear',
  'briefingCard',
  'briefingQuickUpdate',
  'entryCard',
  'text',
  'typedSave',
  'institution',
  'status',
  'type'
];

for (const id of requiredIds) {
  const pattern = new RegExp(`id=["']${id}["']`);
  if (!pattern.test(html)) {
    throw new Error(`UAR_UI_CONTRACT_MISSING_ID:${id}`);
  }
}

const idMatches = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = [...new Set(idMatches.filter((id, index) => idMatches.indexOf(id) !== index))];
if (duplicates.length) {
  throw new Error(`UAR_UI_CONTRACT_DUPLICATE_IDS:${duplicates.join(',')}`);
}

const requiredScripts = [
  '/auth.js',
  '/onboarding.js',
  '/request-id.js',
  '/app.js',
  '/inference-guard.js',
  '/quick-save.js',
  '/manual-input.js',
  '/briefing-legacy-loader.js',
  '/briefing-v2.js',
  '/briefing-v2-expand-state.js',
  '/briefing-edit.js',
  '/home-ux.js'
];

const scriptSources = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
for (const expected of requiredScripts) {
  const source = scriptSources.find(value => value.split('?')[0] === expected);
  if (!source) throw new Error(`UAR_UI_CONTRACT_MISSING_SCRIPT:${expected}`);
  const localPath = path.join(root, 'public', expected.replace(/^\//, ''));
  if (!fs.existsSync(localPath)) throw new Error(`UAR_UI_CONTRACT_SCRIPT_FILE_MISSING:${expected}`);
}

const homeUxCss = fs.readFileSync(path.join(root, 'public', 'home-ux.css'), 'utf8');
if (!/\.voice-quick-dock\{[^}]*position:fixed/.test(homeUxCss)
  || !/\.voice-quick-dock\{[^}]*left:50%/.test(homeUxCss)
  || !homeUxCss.includes('safe-area-inset-bottom')
  || !/\.voice-quick-dock \.mic\{[^}]*position:absolute/.test(homeUxCss)) {
  throw new Error('UAR_UI_CONTRACT_THUMB_FIRST_MIC_MISSING');
}

const homeUxScript = fs.readFileSync(path.join(root, 'public', 'home-ux.js'), 'utf8');
for (const token of ['voiceQuickDock', 'voiceDockTimer', 'voiceDockCancel', 'voiceDockManual', '취소', '메모']) {
  if (!homeUxScript.includes(token)) throw new Error(`UAR_UI_CONTRACT_VOICE_QUICK_DOCK_MISSING:${token}`);
}
if (!homeUxScript.includes('$("clear")?.click()') || !homeUxScript.includes('$("manualEntry")?.click()')) {
  throw new Error('UAR_UI_CONTRACT_VOICE_QUICK_DOCK_REUSE_MISSING');
}

const legacyLoaderPath = path.join(root, 'public', 'briefing-legacy-loader.js');
const legacyBriefingPath = path.join(root, 'public', 'briefing.js');
const legacyLoader = fs.readFileSync(legacyLoaderPath, 'utf8');
if (!fs.existsSync(legacyBriefingPath) || !legacyLoader.includes('/briefing.js')) {
  throw new Error('UAR_UI_CONTRACT_LEGACY_BRIEFING_BOUNDARY_MISSING');
}

if (!html.includes('rel="manifest"') || !html.includes('/manifest.webmanifest')) {
  throw new Error('UAR_UI_CONTRACT_MANIFEST_LINK_MISSING');
}
if (!fs.existsSync(path.join(root, 'public', 'sw.js'))) {
  throw new Error('UAR_UI_CONTRACT_SERVICE_WORKER_MISSING');
}

const appScript = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
if (!appScript.includes('navigator.serviceWorker.register("/sw.js")')) {
  throw new Error('UAR_UI_CONTRACT_SERVICE_WORKER_REGISTRATION_MISSING');
}
if (appScript.includes('fetch("/api/worklog")')) {
  throw new Error('UAR_UI_CONTRACT_STARTUP_WORKLOG_HEALTH_FETCH_FORBIDDEN');
}
if (!appScript.includes('worklog:platform-auth-changed') || !appScript.includes('WorklogPlatformAuth?.readSession?.()')) {
  throw new Error('UAR_UI_CONTRACT_LOCAL_AUTH_HEALTH_STATE_MISSING');
}

console.log(`UAR_UI_CONTRACT_PASS ids=${requiredIds.length} scripts=${requiredScripts.length}`);
