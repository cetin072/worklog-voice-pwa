import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateSource, classifyResult, validateReceipt, verifyRelease } from '../scripts/firebase-device-qa.mjs';

const workflow = fs.readFileSync('.github/workflows/firebase-test-lab.yml', 'utf8');

test('physical gate is explicit and serialized; ordinary PR checks are not billed', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|schedule:|continue-on-error:/);
  assert.match(workflow, /source_sha:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /ref: \$\{\{ inputs.source_sha \}\}/);
  assert.match(workflow, /artifacts\.data\.artifacts\.some/);
  assert.match(workflow, /!a\.expired/);
  assert.match(workflow, /steps\.previous\.outputs\.run_id == ''/);
  assert.match(workflow, /name: Confirm Test Lab target is physical Pixel 5/);
  assert.match(workflow, /grep -qi 'physical'/);
  assert.match(workflow, /--type=robo/);
  assert.match(workflow, /model=\$MODEL,version=\$VERSION,locale=ko,orientation=portrait/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /node scripts\/firebase-device-qa.mjs record/);
  assert.match(fs.readFileSync('.github/workflows/play-android-aab.yml', 'utf8'), /node scripts\/firebase-device-qa.mjs verify/);
});

const sha = 'a'.repeat(40), repository = 'cetin072/worklog-voice-pwa', runId = '123';
const receipt = { outcome: 'PASS', sourceSha: sha, repository, runId, model: 'redfin', androidVersion: '30' };
const run = { id: 123, conclusion: 'success', status: 'completed', event: 'workflow_dispatch', head_branch: 'main', repository: { full_name: repository }, path: '.github/workflows/firebase-test-lab.yml' };
const evidence = { sourceSha: sha, repository, runId, receipt, run };

test('source must be an exact immutable SHA', () => {
  assert.equal(validateSource(sha), sha);
  for (const bad of ['main', 'abc123', '', `${sha}\n`, 'A'.repeat(40)]) assert.throws(() => validateSource(bad));
});

test('quota exhaustion stays waiting, including malformed successful quota output', () => {
  assert.equal(classifyResult(0, 'passed'), 'PASS');
  assert.equal(classifyResult(1, 'test failure'), 'FAIL');
  for (const code of [0, 1]) assert.equal(classifyResult(code, 'TEST_QUOTA_EXCEEDED'), 'WAITING_QUOTA');
  assert.throws(() => classifyResult(NaN, ''));
});

test('only same-source same-target PASS can be reused', () => {
  assert.equal(validateReceipt(receipt, sha, repository, runId), receipt);
  for (const patch of [{ outcome: 'WAITING_QUOTA' }, { outcome: 'FAIL' }, { sourceSha: 'b'.repeat(40) }, { model: 'virtual' }, { androidVersion: '35' }, { repository: 'other/repo' }, { runId: '456' }]) {
    assert.throws(() => validateReceipt({ ...receipt, ...patch }, sha, repository, runId));
  }
});

test('release requires physical evidence with workflow provenance', () => {
  assert.equal(verifyRelease(evidence), receipt);
  for (const patch of [{ conclusion: 'failure' }, { event: 'pull_request' }, { head_branch: 'other' }, { path: '.github/workflows/other.yml' }, { repository: { full_name: 'other/repo' } }, { id: 456 }]) {
    assert.throws(() => verifyRelease({ ...evidence, run: { ...run, ...patch } }));
  }
  assert.throws(() => verifyRelease({ ...evidence, receipt: { ...receipt, sourceSha: 'b'.repeat(40) } }));
});

test('approved exception is explicit and never masquerades as physical PASS', () => {
  assert.throws(() => verifyRelease({ sourceSha: sha, repository }));
  assert.throws(() => verifyRelease({ sourceSha: sha, repository, exception: '   ' }));
  assert.throws(() => verifyRelease({ ...evidence, exception: 'approved' }));
  assert.deepEqual(verifyRelease({ sourceSha: sha, repository, exception: '사용자 승인 / quota / 로컬 검수 기록' }),
    { outcome: 'APPROVED_EXCEPTION', reason: '사용자 승인 / quota / 로컬 검수 기록' });
});

test('real CLI writes quota wait evidence, fails closed, and reuses only a matching PASS', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-physical-'));
  try {
    execFileSync('git', ['init', '-q', cwd]);
    execFileSync('git', ['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd });
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    fs.mkdirSync(path.join(cwd, 'physical-result'));
    const log = path.join(cwd, 'physical-result/testlab.log');
    const result = path.join(cwd, 'physical-result/result.json');
    const script = path.resolve('scripts/firebase-device-qa.mjs');
    const env = { ...process.env, SOURCE_SHA: sourceSha, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId,
      GITHUB_STEP_SUMMARY: path.join(cwd, 'summary.md'), TEST_EXIT_CODE: '1' };
    fs.writeFileSync(log, 'Reason: TEST_QUOTA_EXCEEDED');
    assert.equal(spawnSync(process.execPath, [script, 'record'], { cwd, env }).status, 1);
    assert.equal(JSON.parse(fs.readFileSync(result)).outcome, 'WAITING_QUOTA');
    assert.equal(spawnSync(process.execPath, [script, 'reuse'], { cwd, env: { ...env, PREVIOUS_RUN_ID: runId } }).status, 1);
    fs.writeFileSync(log, 'all tests passed');
    assert.equal(spawnSync(process.execPath, [script, 'record'], { cwd, env: { ...env, TEST_EXIT_CODE: '0' } }).status, 0);
    assert.equal(spawnSync(process.execPath, [script, 'reuse'], { cwd, env: { ...env, GITHUB_RUN_ID: '456', PREVIOUS_RUN_ID: runId } }).status, 0);
    const reused = JSON.parse(fs.readFileSync(result));
    assert.equal(reused.runId, '456');assert.equal(reused.reusedFrom, runId);
    assert.equal(spawnSync(process.execPath, [script, 'verify'], { cwd, env: { ...env, PHYSICAL_GATE_RUN_ID: '', PHYSICAL_GATE_EXCEPTION: '' } }).status, 1);
    assert.equal(spawnSync(process.execPath, [script, 'verify'], { cwd, env: { ...env, PHYSICAL_GATE_RUN_ID: '', PHYSICAL_GATE_EXCEPTION: 'user-approved local QA / reference 1' } }).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'physical-result/release-decision.json'))).outcome, 'APPROVED_EXCEPTION');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
