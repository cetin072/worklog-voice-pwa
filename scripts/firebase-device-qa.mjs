import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function validateSource(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw Error('Exact 40-character source SHA required');
  return sha;
}

export function classifyResult(exitCode, log) {
  if (!Number.isInteger(exitCode) || exitCode < 0) throw Error('Invalid test exit code');
  if (/TEST_QUOTA_EXCEEDED/.test(log)) return 'WAITING_QUOTA';
  return exitCode === 0 ? 'PASS' : 'FAIL';
}

export function validateReceipt(receipt, sourceSha, repository, runId) {
  validateSource(sourceSha);
  if (receipt?.outcome !== 'PASS' || receipt.sourceSha !== sourceSha ||
      receipt.repository !== repository || String(receipt.runId) !== String(runId) ||
      receipt.model !== 'redfin' || receipt.androidVersion !== '30') {
    throw Error('No matching physical-device PASS for this source and target');
  }
  return receipt;
}

export function verifyRelease({ sourceSha, repository, runId, exception, run, receipt }) {
  validateSource(sourceSha);
  const reason = (exception || '').trim();
  if (reason && runId) throw Error('Choose physical evidence OR an approved exception');
  if (reason) return { outcome: 'APPROVED_EXCEPTION', reason };
  if (!/^[0-9]+$/.test(runId || '')) throw Error('Physical result run ID or user-approved exception required');
  if (String(run?.id) !== runId || run?.conclusion !== 'success' || run?.status !== 'completed' ||
      run?.event !== 'workflow_dispatch' || run?.head_branch !== 'main' ||
      run?.repository?.full_name !== repository ||
      run?.path !== '.github/workflows/firebase-test-lab.yml') {
    throw Error('Evidence must come from the successful manual physical workflow on main');
  }
  return validateReceipt(receipt, sourceSha, repository, runId);
}

function summary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

function main(command) {
  const env = process.env;
  const sourceSha = validateSource(env.SOURCE_SHA);
  const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (checkedOut !== sourceSha) throw Error('Checked-out source does not match requested SHA');
  const receiptPath = 'physical-result/result.json';
  if (command === 'record') {
    const log = readFileSync('physical-result/testlab.log', 'utf8');
    const outcome = classifyResult(Number(env.TEST_EXIT_CODE), log);
    const result = { outcome, sourceSha, repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID,
      model: 'redfin', androidVersion: '30', recordedAt: new Date().toISOString() };
    writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n');
    summary(`Firebase physical: **${outcome}** · source \`${sourceSha}\` · Pixel 5 / Android 30`);
    if (outcome === 'WAITING_QUOTA') summary('검사 대기: Test Lab 할당량 초과. 기기 검사는 통과하지 않았습니다. 자동 재시도·유료 전환 없음.');
    if (outcome !== 'PASS') process.exitCode = 1;
  } else if (command === 'reuse') {
    const prior = validateReceipt(JSON.parse(readFileSync(receiptPath, 'utf8')), sourceSha, env.GITHUB_REPOSITORY, env.PREVIOUS_RUN_ID);
    const result = { ...prior, runId: env.GITHUB_RUN_ID, reusedFrom: prior.reusedFrom || prior.runId };
    writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n');
    summary(`Firebase physical: **PASS 재사용** · source \`${sourceSha}\` · 원 검사 https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${result.reusedFrom}`);
  } else if (command === 'verify') {
    const runId = env.PHYSICAL_GATE_RUN_ID || '';
    const result = verifyRelease({ sourceSha, repository: env.GITHUB_REPOSITORY, runId,
      exception: env.PHYSICAL_GATE_EXCEPTION,
      run: runId ? JSON.parse(readFileSync('physical-result/run.json', 'utf8')) : undefined,
      receipt: runId ? JSON.parse(readFileSync(receiptPath, 'utf8')) : undefined });
    mkdirSync('physical-result', { recursive: true });
    writeFileSync('physical-result/release-decision.json', JSON.stringify({ sourceSha, actor: env.GITHUB_ACTOR, ...result }, null, 2) + '\n');
    summary(`Physical release decision: **${result.outcome}** · source \`${sourceSha}\`${result.reason ? ` · 사용자 승인 예외: ${result.reason}` : ` · run ${runId}`}`);
  } else throw Error('Expected record, reuse or verify');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
