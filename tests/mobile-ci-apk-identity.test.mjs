import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const chooseConfig = require('../mobile/app.config.js');
const base = JSON.parse(readFileSync(new URL('../mobile/app.json', import.meta.url), 'utf8')).expo;
const ci = readFileSync(new URL('../.github/workflows/mobile-foundation.yml', import.meta.url), 'utf8');
const play = readFileSync(new URL('../.github/workflows/play-android-aab.yml', import.meta.url), 'utf8');

function configFor(variant) {
  const previous = process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
  try {
    if (variant === null) delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
    else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT = variant;
    return chooseConfig({ config: base });
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
    else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT = previous;
  }
}

test('Play production identity stays unchanged, including deep link and version', () => {
  assert.deepEqual(configFor('production'), base);
  assert.deepEqual(configFor(null), base);
  assert.equal(base.android.package, 'com.cetin072.worklog');
  assert.equal(base.scheme, 'worklog');
});

test('CI QA identity is isolated from Play and cannot downgrade QA code 2', () => {
  const qa = configFor('qa');
  assert.equal(qa.android.package, 'com.cetin072.worklog.qa');
  assert.equal(qa.scheme, 'worklog-qa');
  assert.equal(qa.name, '업무수첩 QA');
  assert.ok(qa.android.versionCode >= 2);
  assert.equal(base.android.package, 'com.cetin072.worklog');
  assert.equal(base.version, qa.version);
});

test('invalid app variant is rejected before creating a native build', () => {
  assert.throws(() => configFor('staging'), /must be production or qa/);
});

test('every standalone CI APK job uses QA identity and checks actual APK manifest', () => {
  for (const job of ['android-standalone', 'android-physical-qa-apk', 'android-runtime-smoke']) {
    const match = ci.match(new RegExp('^  ' + job + ':\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|$(?![\\s\\S]))', 'm'));
    assert.ok(match, job + ' exists');
    assert.match(match[1], /^    env:\n      EXPO_PUBLIC_WORKLOG_APP_VARIANT: qa$/m);
    assert.match(match[1], /verify-qa-apk\.sh/);
  }
});

test('Play workflow explicitly builds production identity with upload key', () => {
  assert.match(play, /EXPO_PUBLIC_WORKLOG_APP_VARIANT: production/);
  assert.match(play, /WORKLOG_PLAY_SIGNING: '1'/);
  assert.match(play, /bundleRelease --no-daemon/);
});
