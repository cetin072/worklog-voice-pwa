import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { calendarSlot, evaluateSchedule, publishedDeploy, decide, deployInput, validateHook, guard, trigger, runCycle, HOOK_TITLE } from '../scripts/scheduled-netlify-release.mjs';

const config = JSON.parse(readFileSync(new URL('../scripts/release-policy.json', import.meta.url), 'utf8'));
const a = 'a'.repeat(40), b = 'b'.repeat(40);
const due = new Date('2026-10-21T08:20:00Z');
const published = { id: 'published-old', state: 'ready', context: 'production', commit_ref: a, published_at: '2026-10-18T08:00:00Z' };
const snapshot = { id: config.site_id, published_deploy: published };
const run = { id: 100, head_branch: 'main', event: 'schedule', run_attempt: 1, created_at: due.toISOString() };
const env = { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: config.repository, GITHUB_RUN_ID: '100' };
const changed = config.repository.endsWith('survival-interactive-series') ? 'archive/web/src/App.tsx' : config.repository.endsWith('worklog-voice-pwa') ? 'public/app.js' : 'index.html';
const payload = { version: 1, repository: config.repository, site_id: config.site_id, source_main_sha: b,
  run_id: '100', run_created_at: due.toISOString(), issued_at: due.toISOString(), slot_index: 1 };
const hookEnv = { CONTEXT: 'production', BRANCH: 'main', COMMIT_REF: b, INCOMING_HOOK_TITLE: HOOK_TITLE, INCOMING_HOOK_BODY: JSON.stringify(payload) };

function cycle(overrides = {}) {
  return runCycle({ config, env, api: async route => route.includes('/actions/runs/') ? run : { total_count: 1, workflow_runs: [run] },
    snapshot: async () => snapshot, head: async () => b, files: async () => [changed], preflight: async () => ({ status: 'READY' }),
    refresh: async () => b, post: async body => ({ status: 'PUBLISHED', source_main_sha: body.source_main_sha }),
    now: () => due, ...overrides });
}
const forbidden = () => { throw new Error('forbidden side effect'); };

test('fixed slots survive 900 transitions, leap days, month/year boundaries and NO_CHANGES', () => {
  for (let i = 1; i < 901; i++) {
    const at = new Date(Date.parse(config.schedule_anchor_utc) + i * 48 * 3600000);
    assert.equal(calendarSlot(config, at).slot.index, i);
    assert.equal(calendarSlot(config, new Date(+at + 24 * 3600000)).status, 'WAITING_SLOT');
    assert.equal(Date.parse(calendarSlot(config, at).next_check_utc) - at, 48 * 3600000);
  }
  assert.equal(calendarSlot(config, '2026-10-20T08:20:00Z').status, 'WAITING_SLOT');
});
test('creation time owns slot; retries, simultaneous and cancelled/failed/no-change checks cannot publish twice', () => {
  for (const conclusion of ['failure', 'cancelled', 'success', null]) {
    assert.equal(evaluateSchedule(config, run, [{ ...run, id: 99, conclusion }], due).status, 'SLOT_ALREADY_CHECKED');
  }
  assert.equal(evaluateSchedule(config, { ...run, run_attempt: 2 }, [], due).status, 'SLOT_ALREADY_CHECKED');
  assert.equal(evaluateSchedule(config, run, [], new Date('2026-10-23T08:20:00Z')).status, 'MISSED_SLOT');
  assert.equal(evaluateSchedule(config, run, [{ ...run, id: 101 }], due).status, 'DUE');
});
test('actual 48 hours, rather than calendar dates, are required since successful publication', () => {
  const late = { ...published, published_at: '2026-10-19T08:20:01Z' };
  assert.equal(decide(config, late, b, [changed], due).status, 'WAITING_WINDOW');
  assert.equal(decide(config, { ...late, published_at: '2026-10-19T08:20:00Z' }, b, [changed], due).status, 'READY');
});
test('only actual published Production is authoritative; failed and Preview records reject', () => {
  for (const patch of [{ state: 'error' }, { context: 'deploy-preview' }, { published_at: null }, { commit_ref: 'bad' }]) {
    assert.throws(() => publishedDeploy({ ...snapshot, published_deploy: { ...published, ...patch } }, config.site_id));
  }
  assert.throws(() => publishedDeploy({ ...snapshot, id: 'wrong' }, config.site_id));
});
test('native mobile, tests and documentation changes do not create a deployment', () => {
  assert.equal(decide(config, published, b, ['mobile/package.json', 'docs/readme.md', '.github/workflows/check.yml', 'tests/a.test.mjs'], due).status, 'NO_CHANGES');
  assert.equal(deployInput(config, changed), true);
  assert.equal(deployInput(config, changed.replace(/[^/]+$/, 'a.test.mjs')), false);
});
test('off-day and duplicate checks stop before even reading Production or comparing content', async () => {
  assert.equal((await cycle({ api: async () => ({ ...run, created_at: '2026-10-20T08:20:00Z' }), snapshot: forbidden })).status, 'WAITING_SLOT');
  assert.equal((await cycle({ api: async route => route.includes('/actions/runs/') ? run : { total_count: 2, workflow_runs: [run, { ...run, id: 99 }] }, snapshot: forbidden })).status, 'SLOT_ALREADY_CHECKED');
});
test('incomplete history, wrong repository and non-main scheduled runs fail closed', async () => {
  await assert.rejects(cycle({ api: async route => route.includes('/actions/runs/') ? run : { total_count: 2, workflow_runs: [run] } }), /SLOT_HISTORY_INCOMPLETE/);
  for (const patch of [{ GITHUB_REF: 'refs/heads/draft' }, { GITHUB_REPOSITORY: 'wrong/repo' }]) await assert.rejects(cycle({ env: { ...env, ...patch } }), /MAIN_SCHEDULE_REQUIRED/);
});
test('no changes creates no preflight, hook, commit, PR or file write', async () => {
  assert.equal((await cycle({ files: async () => [], preflight: forbidden, refresh: forbidden, post: forbidden })).status, 'NO_CHANGES');
});
test('changed approved main posts once with exact SHA and slot; a branch manual dispatch is read-only', async () => {
  let posts = 0;
  const result = await cycle({ post: async body => { posts++; assert.equal(body.source_main_sha, b); assert.equal(body.slot_index, 1); return { status: 'PUBLISHED' }; } });
  assert.equal(result.status, 'PUBLISHED'); assert.equal(posts, 1);
  assert.equal((await cycle({ env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/draft' }, post: forbidden, refresh: forbidden })).status, 'DRY_RUN_READY');
});
test('DB incompatibility, main movement or intervening publication stops before hook', async () => {
  assert.equal((await cycle({ preflight: async () => ({ status: 'DB_NOT_READY' }), post: forbidden })).status, 'DB_NOT_READY');
  assert.equal((await cycle({ refresh: async () => a, post: forbidden })).status, 'MAIN_MOVED');
  let reads = 0;
  assert.equal((await cycle({ snapshot: async () => ++reads === 1 ? snapshot : { ...snapshot, published_deploy: { ...published, id: 'new' } }, post: forbidden })).status, 'PUBLICATION_CHANGED');
});
test('failed publication is retried at next 48h slot using unchanged actual public SHA', async () => {
  await assert.rejects(cycle({ post: async () => { throw new Error('PUBLICATION_NOT_CONFIRMED'); } }), /PUBLICATION_NOT_CONFIRMED/);
  const next = new Date('2026-10-23T08:20:00Z');
  const nextRun = { ...run, id: 102, created_at: next.toISOString() };
  let posts = 0;
  const result = await cycle({ now: () => next, api: async route => route.includes('/actions/runs/') ? nextRun : { total_count: 1, workflow_runs: [nextRun] },
    post: async () => { posts++; return { status: 'PUBLISHED' }; } });
  assert.equal(result.status, 'PUBLISHED'); assert.equal(posts, 1);
});
test('ordinary main build cannot reach Production; Preview and QA branch builds remain allowed', async () => {
  assert.throws(() => validateHook(config, { CONTEXT: 'production', BRANCH: 'main', COMMIT_REF: b }, due), /SCHEDULED_HOOK_REQUIRED/);
  assert.equal(validateHook(config, { CONTEXT: 'deploy-preview' }, due), null);
  assert.equal((await guard(config, { CONTEXT: 'branch-deploy' }, { fetcher: forbidden, now: due })).status, 'PREVIEW_ALLOWED');
});
test('build guard verifies exact source, repository, site, branch, hook, slot, freshness and encoded payload', () => {
  assert.equal(validateHook(config, hookEnv, due).source_main_sha, b);
  assert.equal(validateHook(config, { ...hookEnv, INCOMING_HOOK_BODY: encodeURIComponent(JSON.stringify(payload)) }, due).source_main_sha, b);
  for (const patch of [{ source_main_sha: a }, { repository: 'wrong/repo' }, { site_id: 'wrong' }, { slot_index: 2 }, { issued_at: '2026-10-20T08:20:00Z' }, { issued_at: '2026-10-22T08:20:00Z' }, { run_id: 'bad' }]) {
    assert.throws(() => validateHook(config, { ...hookEnv, INCOMING_HOOK_BODY: JSON.stringify({ ...payload, ...patch }) }, due));
  }
  for (const patch of [{ BRANCH: 'draft' }, { COMMIT_REF: a }, { INCOMING_HOOK_TITLE: 'other' }]) assert.throws(() => validateHook(config, { ...hookEnv, ...patch }, due));
});
test('build guard rejects already published or too recent public version before writing marker', async () => {
  for (const [patch, error] of [[{ commit_ref: b }, /ALREADY_PUBLISHED/], [{ published_at: '2026-10-20T00:00:00Z' }, /WAITING_WINDOW/]]) {
    await assert.rejects(guard(config, hookEnv, { now: due, fetcher: async () => ({ ok: true, json: async () => ({ ...snapshot, published_deploy: { ...published, ...patch } }) }) }), error);
  }
});
test('one POST even with lost acknowledgement; only exact public SHA ends observation', async () => {
  for (const lost of [false, true]) {
    let posts = 0, gets = 0;
    const result = await trigger(config, payload, 'https://api.netlify.com/build_hooks/' + 'a'.repeat(24), {
      attempts: 2, wait: async () => {}, fetcher: async (url, options) => {
        if (options.method === 'POST') { posts++; if (lost) throw new Error('secret URL must not be logged'); return { ok: true }; }
        gets++; return { ok: true, json: async () => ({ ...snapshot, published_deploy: { ...published, commit_ref: gets > 1 ? b : a } }) };
      } });
    assert.equal(result.status, 'PUBLISHED'); assert.equal(posts, 1); assert.equal(gets, 2);
  }
});
test('successful build guard writes only generated marker after all checks; Preview preserves files', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'release-guard-'));
  const marker = join(temp, 'production.json');
  const localConfig = { ...config, marker_path: marker };
  try {
    const result = await guard(localConfig, hookEnv, { now: due,
      fetcher: async () => ({ ok: true, json: async () => snapshot }) });
    assert.equal(result.status, 'SCHEDULED_PRODUCTION_ALLOWED');
    const first = readFileSync(marker, 'utf8');
    assert.equal(JSON.parse(first).source_main_sha, b);
    assert.equal(JSON.parse(first).release_run_id, '100');
    await guard(localConfig, { CONTEXT: 'deploy-preview' }, { fetcher: forbidden, now: due });
    assert.equal(readFileSync(marker, 'utf8'), first);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('failed build preserves published state; no POST retry or raw secret appears in error', async () => {
  let posts = 0;
  await assert.rejects(trigger(config, payload, 'https://api.netlify.com/build_hooks/' + 'a'.repeat(24), {
    attempts: 2, wait: async () => {}, fetcher: async (url, options) => {
      if (options.method === 'POST') { posts++; throw new Error(url); }
      return { ok: true, json: async () => snapshot };
    } }), /^Error: HOOK_ACK_OR_PUBLICATION_FAILED$/);
  assert.equal(posts, 1); assert.equal(snapshot.published_deploy.commit_ref, a);
});
test('ignore command stops Production only; CLI dry-run does not mutate repository', () => {
  const file = new URL('../scripts/scheduled-netlify-release.mjs', import.meta.url);
  for (const [context, expected] of [['production', 0], ['deploy-preview', 1], ['branch-deploy', 1]]) {
    const actual = spawnSync(process.execPath, [file.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'ignore'], { env: { ...process.env, CONTEXT: context }, encoding: 'utf8' });
    assert.equal(actual.status, expected, actual.stderr);
  }
  const source = readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /git\(['"](?:push|commit|merge|reset|checkout)['"]/);
});

test('web Production has no recurring trigger while read-only manual inspection remains', () => {
  assert.equal(config.schedule_enabled, false);
  const workflow = readFileSync(new URL('../.github/workflows/production-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /^  schedule:|cron:/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /inputs.action == 'deploy-now' && github.ref == 'refs\/heads\/main'/);
});

// Explicit manual intent reuses the same concurrency group and one-shot hook.
test('manual deploy-now uses latest main off-slot with no publication cooldown', async () => {
  const at = new Date('2026-10-20T08:20:00Z');
  const manualRun = { ...run, event: 'workflow_dispatch', created_at: at.toISOString() };
  let posts = 0;
  const result = await cycle({ env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', RELEASE_ACTION: 'deploy-now' },
    now: () => at, api: async () => manualRun,
    snapshot: async () => ({ ...snapshot, published_deploy: { ...published, published_at: new Date(+at - 1000).toISOString() } }),
    post: async body => {
      posts++; assert.equal(body.version, 3); assert.equal(body.mode, 'MANUAL_MAIN'); assert.equal(body.source_main_sha, b);
      assert.equal(validateHook(config, { ...hookEnv, INCOMING_HOOK_BODY: JSON.stringify(body) }, at).version, 3);
      return { status: 'PUBLISHED' };
    } });
  assert.equal(result.status, 'PUBLISHED'); assert.equal(posts, 1);
  const manualEnv = { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', RELEASE_ACTION: 'deploy-now' };
  assert.equal((await cycle({ env: manualEnv, api: async () => manualRun, files: async () => [], post: forbidden })).status, 'NO_CHANGES');
  assert.equal((await cycle({ env: manualEnv, api: async () => ({ ...manualRun, run_attempt: 2 }), post: forbidden })).status, 'RUN_ALREADY_CHECKED');
  await assert.rejects(cycle({ env: { ...manualEnv, GITHUB_REF: 'refs/heads/draft' }, post: forbidden }), /MAIN_MANUAL_REQUIRED/);
  assert.equal((await cycle({ env: manualEnv, api: async () => manualRun, refresh: async () => a, post: forbidden })).status, 'MAIN_MOVED');
});
test('manual build validates intent and freshness but needs no fixed slot', async () => {
  const at = new Date('2026-10-20T08:20:00Z');
  const body = { ...payload, version: 3, mode: 'MANUAL_MAIN', run_created_at: at.toISOString(), issued_at: at.toISOString() };
  const manualEnv = { ...hookEnv, INCOMING_HOOK_BODY: JSON.stringify(body) };
  assert.equal((await guard({ ...config, marker_path: null }, manualEnv, { now: at,
    fetcher: async () => ({ ok: true, json: async () => ({ ...snapshot, published_deploy: { ...published, published_at: new Date(+at - 1000).toISOString() } }) }) })).status, 'MANUAL_PRODUCTION_ALLOWED');
  for (const patch of [{ mode: 'anything' }, { run_created_at: 'invalid' }, { issued_at: '2026-10-19T08:20:00Z' }]) {
    assert.throws(() => validateHook(config, { ...manualEnv, INCOMING_HOOK_BODY: JSON.stringify({ ...body, ...patch }) }, at));
  }
});

test('queued duplicate manual clicks publish once and manual history never consumes a scheduled slot', async () => {
  let live = snapshot, posts = 0;
  const manualRun = { ...run, event: 'workflow_dispatch' };
  const options = { env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', RELEASE_ACTION: 'deploy-now' },
    api: async () => manualRun, snapshot: async () => live,
    files: async (base, head) => base === head ? [] : [changed],
    post: async () => { posts++; live = { ...snapshot, published_deploy: { ...published, id: 'manual-new', commit_ref: b, published_at: due.toISOString() } }; return { status: 'PUBLISHED' }; } };
  assert.equal((await cycle(options)).status, 'PUBLISHED');
  assert.equal((await cycle(options)).status, 'NO_CHANGES');
  assert.equal(posts, 1);
  assert.equal(evaluateSchedule(config, run, [{ ...manualRun, id: 99 }], due).status, 'DUE');
});
