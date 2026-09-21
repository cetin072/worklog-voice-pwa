/** Fault-injection proof: run current production-source tests against isolated mutants.
 * Usage: node scripts/verify-mobile-device-mutations.mjs [evidence-directory]
 * Originals are never changed; temporary siblings are removed in finally.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'worklog-device-mutations-'));
mkdirSync(output, { recursive: true });
const cases = [
  ['reminder-fake-success', 'schedule-reminder-service.ts', 'const actualId = await deps.driver.schedule(next, scheduleId);', 'const actualId = next.identifier;', 'REMINDER_TEST_SOURCE_URL', 'mobile-reminders.runtime.test.mjs', 15],
  ['reminder-no-operation-queue', 'schedule-reminder-service.ts', 'const task = tail.then(run);', 'const task = Promise.resolve().then(run);', 'REMINDER_TEST_SOURCE_URL', 'mobile-reminders.runtime.test.mjs', 15],
];
const results = [];
for (const [name, file, before, after, variable, testFile, expectedTests] of cases) {
  const sourcePath = join(root, 'mobile/src/features/schedule', file);
  const original = readFileSync(sourcePath, 'utf8');
  assert.ok(original.includes(before), `${name}: mutation target changed; update this proof, not production code`);
  const target = join(dirname(sourcePath), `.mutation-${randomUUID()}.ts`);
  try {
    writeFileSync(target, original.replace(before, after));
    const child = spawnSync(process.execPath, ['--test', join(root, 'tests', testFile)], {
      cwd: root, env: { ...process.env, [variable]: pathToFileURL(target).href }, encoding: 'utf8', timeout: 30_000,
    });
    const log = `${child.stdout || ''}${child.stderr || ''}`;
    writeFileSync(join(output, `${name}.log`), log);
    const tests = Number(log.match(/^# tests (\d+)$/m)?.[1]);
    const failed = Number(log.match(/^# fail (\d+)$/m)?.[1]);
    // An import/syntax failure or a timeout is not proof that a behavioral mutation was caught.
    const detected = child.status === 1 && tests === expectedTests && failed > 0 && /ERR_ASSERTION/.test(log);
    results.push({ name, exitCode: child.status, tests, failed, detected });
  } finally { rmSync(target, { force: true }); }
}
writeFileSync(join(output, 'mutation-results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ output, results }, null, 2));
assert.ok(results.every((r) => r.detected), 'A mutation escaped its runtime tests; inspect evidence before acceptance');
