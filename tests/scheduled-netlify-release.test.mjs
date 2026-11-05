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
  assert.match(workflow, /inputs.action == 'redeploy-config'\) && github.ref == 'refs\/heads\/main'/);
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

// Config-only release is deliberately separate from normal manual/source releases.
const oldId = '1'.repeat(24), newId = '2'.repeat(24);
const configPublished = { ...published, id: oldId };
const configSnapshot = { ...snapshot, published_deploy: configPublished };
const configRun = { ...run, event: 'workflow_dispatch' };
const configEnv = { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', RELEASE_ACTION: 'redeploy-config',
  EXPECTED_DEPLOY_ID: oldId, EXPECTED_SOURCE_SHA: a, CONFIG_CHANGE_REF: 'worklog-cutover-20261104' };
const configPayload = { ...payload, version: 4, mode: 'CONFIG_ONLY', source_main_sha: a,
  expected_deploy_id: oldId, expected_sha: a, change_ref: configEnv.CONFIG_CHANGE_REF };
const configHookEnv = { ...hookEnv, COMMIT_REF: a, DEPLOY_ID: newId, INCOMING_HOOK_BODY: JSON.stringify(configPayload) };
const configCycle = overrides => cycle({ env: configEnv, api: async () => configRun,
  snapshot: async () => configSnapshot, head: async () => a, refresh: async () => a,
  files: forbidden, ...overrides });

test('explicit config mode posts once with unchanged main and exact deployment baseline', async () => {
  let posts = 0;
  const result = await configCycle({ post: async body => {
    posts++; assert.equal(body.version, 4); assert.equal(body.mode, 'CONFIG_ONLY');
    assert.equal(body.source_main_sha, a); assert.equal(body.expected_sha, a);
    assert.equal(body.expected_deploy_id, oldId); assert.equal(body.change_ref, configEnv.CONFIG_CHANGE_REF);
    return { status: 'PUBLISHED', deployment_id: newId };
  } });
  assert.equal(result.deployment_id, newId); assert.equal(posts, 1);
});

test('config mode rejects missing intent, unsafe references, non-main/scheduled calls and stale source/baseline', async () => {
  for (const patch of [{ EXPECTED_DEPLOY_ID: '' }, { EXPECTED_SOURCE_SHA: '' }, { CONFIG_CHANGE_REF: '' },
    { CONFIG_CHANGE_REF: 'secret token with spaces' }, { CONFIG_CHANGE_REF: 'x'.repeat(121) }]) {
    await assert.rejects(configCycle({ env: { ...configEnv, ...patch }, post: forbidden }), /CONFIG_INTENT_INVALID/);
  }
  for (const patch of [{ GITHUB_EVENT_NAME: 'schedule' }, { GITHUB_REF: 'refs/heads/other' }, { GITHUB_REPOSITORY: 'wrong/repo' }]) {
    await assert.rejects(configCycle({ env: { ...configEnv, ...patch }, post: forbidden }), /MAIN_MANUAL_REQUIRED/);
  }
  await assert.rejects(configCycle({ head: async () => b, post: forbidden }), /CONFIG_SOURCE_CHANGED/);
  for (const patch of [{ id: newId }, { commit_ref: b }]) {
    await assert.rejects(configCycle({ snapshot: async () => ({ ...configSnapshot, published_deploy: { ...configPublished, ...patch } }), post: forbidden }), /CONFIG_BASELINE_CHANGED/);
  }
  assert.equal((await configCycle({ api: async () => ({ ...configRun, run_attempt: 2 }), post: forbidden })).status, 'RUN_ALREADY_CHECKED');
  assert.equal((await configCycle({ refresh: async () => b, post: forbidden })).status, 'MAIN_MOVED');
  assert.equal((await configCycle({ preflight: async () => ({ status: 'DB_NOT_READY' }), post: forbidden })).status, 'DB_NOT_READY');
  let reads = 0;
  assert.equal((await configCycle({ snapshot: async () => ++reads === 1 ? configSnapshot : { ...configSnapshot, published_deploy: { ...configPublished, id: newId } }, post: forbidden })).status, 'PUBLICATION_CHANGED');
});

test('config build requires fresh exact baseline and writes receipt only after successful checks', async () => {
  const cwd = process.cwd(), temp = mkdtempSync(join(tmpdir(), 'config-release-'));
  process.chdir(temp);
  try {
    const options = { now: due, fetcher: async () => ({ ok: true, json: async () => configSnapshot }) };
    for (const patch of [{ mode: 'MANUAL_MAIN' }, { expected_sha: b }, { expected_deploy_id: '' },
      { change_ref: '' }, { run_created_at: 'invalid' }, { issued_at: '2026-10-20T08:20:00Z' }]) {
      assert.throws(() => validateHook(config, { ...configHookEnv, INCOMING_HOOK_BODY: JSON.stringify({ ...configPayload, ...patch }) }, due));
    }
    await assert.rejects(guard(config, { ...configHookEnv, DEPLOY_ID: oldId }, options), /CONFIG_DEPLOY_ID_INVALID/);
    await assert.rejects(guard(config, configHookEnv, { ...options, fetcher: async () => ({ ok: true, json: async () => ({ ...configSnapshot, published_deploy: { ...configPublished, id: newId } }) }) }), /CONFIG_BASELINE_CHANGED/);
    assert.throws(() => readFileSync('public/.well-known/config-release.json'), /ENOENT/);
    assert.equal((await guard(config, configHookEnv, options)).status, 'CONFIG_PRODUCTION_ALLOWED');
    assert.deepEqual(JSON.parse(readFileSync('public/.well-known/config-release.json')), {
      deploy_id: newId, run_id: '100', expected_deploy_id: oldId, source_main_sha: a, change_ref: configEnv.CONFIG_CHANGE_REF
    });
  } finally { process.chdir(cwd); rmSync(temp, { recursive: true, force: true }); }
});

function observationFixture({ lost = false, deployPatch = {}, receiptPatch = {}, stayOld = false } = {}) {
  let posts = 0, reads = 0, receipts = 0, waits = 0;
  const receipt = { deploy_id: newId, run_id: '100', expected_deploy_id: oldId, source_main_sha: a,
    change_ref: configEnv.CONFIG_CHANGE_REF, ...receiptPatch };
  return {
    counts: () => ({ posts, reads, receipts, waits }),
    options: { attempts: 2, wait: async () => { waits++; }, fetcher: async (url, options) => {
      if (options.method === 'POST') { posts++; if (lost) throw new Error('sensitive upstream failure'); return { ok: true }; }
      if (url.endsWith('/.well-known/config-release.json')) { receipts++; return { ok: true, json: async () => receipt }; }
      reads++;
      return { ok: true, json: async () => ({ ...configSnapshot, published_deploy: reads === 1 || stayOld ? configPublished : {
        ...configPublished, id: newId, published_at: due.toISOString(),
        deploy_ssl_url: `https://${newId}--worklog-voice-pwa.netlify.app`, ...deployPatch
      } }) };
    } }
  };
}
const configTrigger = options => trigger(config, configPayload, 'https://api.netlify.com/build_hooks/' + 'a'.repeat(24), options);

test('same-SHA old ready deploy never confirms; new deploy must have this run receipt even with lost acknowledgement', async () => {
  for (const lost of [false, true]) {
    const fixture = observationFixture({ lost });
    const result = await configTrigger(fixture.options);
    assert.equal(result.deployment_id, newId);
    assert.deepEqual(fixture.counts(), { posts: 1, reads: 3, receipts: 1, waits: 1 });
  }
  const fixture = observationFixture({ stayOld: true });
  await assert.rejects(configTrigger(fixture.options), /^Error: PUBLICATION_NOT_CONFIRMED$/);
  assert.deepEqual(fixture.counts(), { posts: 1, reads: 2, receipts: 0, waits: 1 });
});

test('wrong source/context/state/time/receipt or concurrent deployment fails bounded without retry or rollback', async () => {
  for (const patches of [
    { deployPatch: { commit_ref: b } }, { deployPatch: { context: 'deploy-preview' } },
    { deployPatch: { state: 'error' } }, { deployPatch: { published_at: published.published_at } },
    { deployPatch: { deploy_ssl_url: 'https://attacker.example' } },
    ...['deploy_id', 'run_id', 'expected_deploy_id', 'source_main_sha', 'change_ref'].map(key => ({ receiptPatch: { [key]: 'wrong' } }))
  ]) {
    const fixture = observationFixture(patches);
    await assert.rejects(configTrigger(fixture.options), /^Error: PUBLICATION_NOT_CONFIRMED$/);
    assert.equal(fixture.counts().posts, 1); assert.equal(fixture.counts().reads, 2);
  }
  const lost = observationFixture({ lost: true, stayOld: true });
  await assert.rejects(configTrigger(lost.options), /^Error: HOOK_ACK_OR_PUBLICATION_FAILED$/);
  assert.equal(lost.counts().posts, 1);
});

test('queued second config request with original baseline refuses and rollback requires a fresh explicit baseline', async () => {
  await configCycle({ post: async () => ({ status: 'PUBLISHED', deployment_id: newId }) });
  const current = { ...configSnapshot, published_deploy: { ...configPublished, id: newId } };
  await assert.rejects(configCycle({ snapshot: async () => current, post: forbidden }), /CONFIG_BASELINE_CHANGED/);
  let posts = 0;
  await configCycle({ env: { ...configEnv, EXPECTED_DEPLOY_ID: newId, CONFIG_CHANGE_REF: 'worklog-rollback-20261104' },
    snapshot: async () => current, post: async body => { posts++; assert.equal(body.expected_deploy_id, newId); return { status: 'PUBLISHED' }; } });
  assert.equal(posts, 1);
});


test('invalid observation bound refuses before any POST and publication drift during receipt read cannot pass', async () => {
  for (const attempts of [0, -1, 41, NaN, 1.5]) {
    await assert.rejects(configTrigger({ attempts, fetcher: forbidden }), /OBSERVATION_LIMIT_INVALID/);
  }
  const fixture = observationFixture();
  const fetcher = fixture.options.fetcher;
  let siteReads = 0;
  await assert.rejects(configTrigger({ ...fixture.options, fetcher: async (url, options) => {
    if (url.includes('/api/v1/sites/') && ++siteReads === 3) return { ok: true, json: async () => configSnapshot };
    return fetcher(url, options);
  } }), /PUBLICATION_NOT_CONFIRMED/);
  assert.equal(fixture.counts().posts, 1);
});
