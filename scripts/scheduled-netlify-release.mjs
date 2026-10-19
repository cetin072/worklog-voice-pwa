// Repository-local reuse of Taejang's fixed-slot and exact-publication release guards.
// No Git mutation, PR merge, deployment upload, or automatic HTTP POST retry.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const HOUR = 3600000;
const SHA = /^[a-f0-9]{40}$/;
export const HOOK_TITLE = '48-hour approved main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export function calendarSlot(config, at) {
  const anchor = Date.parse(config.schedule_anchor_utc), time = new Date(at).getTime();
  if (!Number.isFinite(anchor) || !Number.isFinite(time) || config.schedule_interval_hours !== 48) throw new Error('INVALID_SCHEDULE');
  const index = Math.floor((time - anchor) / (48 * HOUR)), start = anchor + index * 48 * HOUR;
  const due = index >= 1 && time < start + 24 * HOUR;
  return { status: due ? 'DUE' : 'WAITING_SLOT',
    slot: due ? { index, start_utc: new Date(start).toISOString(), expires_utc: new Date(start + 24 * HOUR).toISOString() } : null,
    next_check_utc: new Date(anchor + Math.max(1, index + 1) * 48 * HOUR).toISOString() };
}
export function evaluateSchedule(config, run, history, now) {
  if (!run?.id || run.head_branch !== 'main' || run.event !== 'schedule') throw new Error('INVALID_LIVE_RUN');
  const result = calendarSlot(config, run.created_at);
  if (result.status !== 'DUE') return result;
  if (new Date(now) >= new Date(result.slot.expires_utc) || new Date(now) < new Date(result.slot.start_utc)) return { ...result, status: 'MISSED_SLOT' };
  if (run.run_attempt > 1) return { ...result, status: 'SLOT_ALREADY_CHECKED' };
  for (const other of history) {
    if (other.id === run.id || other.event !== 'schedule' || other.head_branch !== 'main') continue;
    if (Date.parse(other.created_at) > Date.parse(run.created_at) || (other.created_at === run.created_at && BigInt(other.id) > BigInt(run.id))) continue;
    if (calendarSlot(config, other.created_at).slot?.index === result.slot.index) return { ...result, status: 'SLOT_ALREADY_CHECKED' };
  }
  return result;
}
export function publishedDeploy(snapshot, siteId) {
  const d = snapshot?.published_deploy;
  if (snapshot?.id !== siteId || d?.state !== 'ready' || d.context !== 'production'
    || !SHA.test(d.commit_ref || '') || !Number.isFinite(Date.parse(d.published_at))) throw new Error('PUBLIC_PRODUCTION_INVALID');
  return d;
}
export function deployInput(config, file) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(?:^|\/)(?:tests?|__tests__)\//.test(file)) return false;
  return config.deploy_inputs.some(pattern => new RegExp(pattern).test(file))
    && !(config.deploy_excludes || []).some(pattern => new RegExp(pattern).test(file));
}
export function decide(config, published, head, files, now) {
  if (!SHA.test(head)) throw new Error('INVALID_SOURCE_SHA');
  const changed = files.filter(file => deployInput(config, file));
  if (!changed.length) return { status: 'NO_CHANGES', source_main_sha: head, changes: [] };
  const elapsed = new Date(now) - new Date(published.published_at);
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('INVALID_PUBLICATION_TIME');
  return { status: elapsed < 48 * HOUR ? 'WAITING_WINDOW' : 'READY', source_main_sha: head, changes: changed };
}
export function validateHook(config, env, now) {
  if (env.CONTEXT !== 'production') return null;
  let payload;
  try {
    const raw = env.INCOMING_HOOK_BODY || '';
    try { payload = JSON.parse(raw); } catch { payload = JSON.parse(decodeURIComponent(raw)); }
  } catch { throw new Error('SCHEDULED_HOOK_REQUIRED'); }
  if (!payload || typeof payload !== 'object') throw new Error('SCHEDULED_HOOK_REQUIRED');
  const age = new Date(now) - new Date(payload.issued_at);
  if (env.BRANCH !== 'main' || env.INCOMING_HOOK_TITLE !== HOOK_TITLE
    || payload.version !== 1 || payload.repository !== config.repository || payload.site_id !== config.site_id
    || !SHA.test(payload.source_main_sha || '') || payload.source_main_sha !== env.COMMIT_REF
    || !/^\d+$/.test(String(payload.run_id)) || !Number.isFinite(age) || age < 0 || age > 90 * 60000) throw new Error('HOOK_SOURCE_OR_TIME_INVALID');
  const slot = calendarSlot(config, payload.run_created_at);
  if (slot.status !== 'DUE' || payload.slot_index !== slot.slot.index
    || new Date(now) < new Date(slot.slot.start_utc) || new Date(now) >= new Date(slot.slot.expires_utc)) throw new Error('HOOK_SLOT_INVALID');
  return payload;
}
async function publicSite(config, fetcher) {
  const response = await fetcher('https://api.netlify.com/api/v1/sites/' + config.site_id, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error('PUBLIC_PRODUCTION_HTTP_' + response.status);
  return response.json();
}
export async function observe(config, sha, fetcher, wait, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const d = publishedDeploy(await publicSite(config, fetcher), config.site_id);
      if (d.commit_ref === sha) return { status: 'PUBLISHED', source_main_sha: sha, published_at: d.published_at };
    } catch { /* Observation errors cannot trigger another build. */ }
    if (i + 1 < attempts) await wait(15000);
  }
  throw new Error('PUBLICATION_NOT_CONFIRMED');
}
export async function trigger(config, payload, hookUrl, { fetcher = fetch, wait = ms => new Promise(r => setTimeout(r, ms)), attempts } = {}) {
  if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[a-f0-9]{24}$/.test(hookUrl || '')) throw new Error('BUILD_HOOK_NOT_CONFIGURED');
  // Never echo hook URL, response body, or raw fetch errors (they may contain secrets).
  let acknowledged = false;
  try {
    const response = await fetcher(hookUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(30000), redirect: 'error' });
    acknowledged = response.ok;
  } catch { /* Ambiguous acknowledgement: observe without another POST. */ }
  try { return await observe(config, payload.source_main_sha, fetcher, wait, attempts); }
  catch { throw new Error(acknowledged ? 'PUBLICATION_NOT_CONFIRMED' : 'HOOK_ACK_OR_PUBLICATION_FAILED'); }
}
export async function runCycle({ config, env, api, snapshot, head, files, preflight, refresh, post, now = () => new Date() }) {
  const dryRun = env.GITHUB_EVENT_NAME !== 'schedule';
  let schedule = calendarSlot(config, now()), run;
  if (!dryRun) {
    if (env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REPOSITORY !== config.repository) throw new Error('MAIN_SCHEDULE_REQUIRED');
    run = await api('/actions/runs/' + env.GITHUB_RUN_ID);
    schedule = calendarSlot(config, run.created_at);
    if (schedule.status !== 'DUE') return schedule;
    const query = new URLSearchParams({ branch: 'main', per_page: '100', created: schedule.slot.start_utc + '..' + schedule.slot.expires_utc });
    const history = await api('/actions/workflows/' + config.workflow + '/runs?' + query);
    if (!Array.isArray(history.workflow_runs) || history.total_count > history.workflow_runs.length || history.workflow_runs.length >= 100) throw new Error('SLOT_HISTORY_INCOMPLETE');
    schedule = evaluateSchedule(config, run, history.workflow_runs, now());
    if (schedule.status !== 'DUE') return schedule;
  }
  const published = publishedDeploy(await snapshot(), config.site_id);
  const sha = await head();
  const plan = { ...decide(config, published, sha, await files(published.commit_ref, sha), now()),
    next_check_utc: schedule.next_check_utc };
  if (plan.status !== 'READY') return plan;
  const ready = await preflight(published.commit_ref, sha);
  if (ready.status !== 'READY') return { ...plan, ...ready };
  if (dryRun) return { ...plan, status: 'DRY_RUN_READY', schedule_status: schedule.status };
  // Revalidate live slot, main and actual public release immediately before one POST.
  if (evaluateSchedule(config, run, [], now()).status !== 'DUE') return { ...plan, status: 'MISSED_SLOT' };
  if (await refresh() !== sha) return { ...plan, status: 'MAIN_MOVED' };
  const latest = publishedDeploy(await snapshot(), config.site_id);
  if (latest.id !== published.id || latest.commit_ref !== published.commit_ref) return { ...plan, status: 'PUBLICATION_CHANGED' };
  if (decide(config, latest, sha, plan.changes, now()).status !== 'READY') return { ...plan, status: 'WAITING_WINDOW' };
  return { ...plan, ...await post({ version: 1, repository: config.repository, site_id: config.site_id,
    source_main_sha: sha, run_id: String(run.id), run_created_at: run.created_at,
    slot_index: schedule.slot.index, issued_at: now().toISOString() }) };
}
export async function guard(config, env = process.env, { fetcher = fetch, now = new Date() } = {}) {
  const payload = validateHook(config, env, now);
  if (!payload) return { status: 'PREVIEW_ALLOWED' };
  const published = publishedDeploy(await publicSite(config, fetcher), config.site_id);
  if (published.commit_ref === payload.source_main_sha) throw new Error('ALREADY_PUBLISHED');
  if (new Date(now) - new Date(published.published_at) < 48 * HOUR) throw new Error('WAITING_WINDOW');
  if (config.marker_path) {
    const markerPath = resolve(config.marker_path);
    let previous = {};
    try { previous = JSON.parse(readFileSync(markerPath, 'utf8')); } catch {}
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, JSON.stringify({ ...previous, source_main_sha: payload.source_main_sha,
      released_at_utc: now.toISOString(), released_on_kst: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now),
      interval_days: 2, release_attempt: (previous.release_attempt || 0) + 1, release_run_id: payload.run_id }, null, 2) + '\n');
  }
  return { status: 'SCHEDULED_PRODUCTION_ALLOWED', source_main_sha: payload.source_main_sha };
}
async function cli() {
  const [mode, configPath] = process.argv.slice(2);
  if (mode === 'ignore') { process.exitCode = process.env.CONTEXT === 'production' ? 0 : 1; return; }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (mode === 'guard') { process.chdir(git('rev-parse', '--show-toplevel')); console.log(JSON.stringify(await guard(config))); return; }
  if (mode !== 'check') throw new Error('USAGE_CHECK_GUARD_IGNORE');
  const api = async route => {
    const response = await fetch('https://api.github.com/repos/' + config.repository + route, {
      headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('GITHUB_READ_HTTP_' + response.status);
    return response.json();
  };
  const result = await runCycle({ config, env: process.env, api,
    snapshot: () => publicSite(config, fetch),
    head: () => git('rev-parse', 'origin/main'),
    files: (base, head) => { git('merge-base', '--is-ancestor', base, head); return git('diff', '--name-only', base, head).split(/\r?\n/).filter(Boolean); },
    preflight: async (publishedSha, head) => {
      if (!config.database_preflight) return { status: 'READY' };
      const { checkProductionDatabase } = await import(pathToFileURL(resolve(config.database_preflight)).href);
      return checkProductionDatabase({ publishedSha, head, token: process.env.SUPABASE_ACCESS_TOKEN, projectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF });
    },
    refresh: async () => (await api('/git/ref/heads/main')).object.sha,
    post: payload => trigger(config, payload, process.env.NETLIFY_PRODUCTION_BUILD_HOOK)
  });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    'Production check: ' + result.status + '\nNext fixed check: ' + result.next_check_utc + '\n');
  if (process.env.RELEASE_RESULT_PATH) writeFileSync(process.env.RELEASE_RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await cli(); } catch (error) {
    const message = /^[A-Z][A-Z0-9_]+$/.test(error.message || '') ? error.message : 'RELEASE_CHECK_FAILED';
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, 'Production check failed: ' + message + '\nPrevious public deployment remains authoritative. Retry at next 48-hour slot.\n');
    if (process.env.RELEASE_RESULT_PATH) writeFileSync(process.env.RELEASE_RESULT_PATH, JSON.stringify({ status: 'FAILED', reason: message }) + '\n');
    console.error(message); process.exitCode = 1;
  }
}
