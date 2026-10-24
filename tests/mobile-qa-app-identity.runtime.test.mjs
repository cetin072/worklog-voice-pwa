import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('mobile/app.config.js', 'utf8');
const original = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8')).expo;
const workflow = fs.readFileSync('.github/workflows/mobile-foundation.yml', 'utf8');
const smoke = fs.readFileSync('mobile/scripts/android-runtime-smoke.sh', 'utf8');
const oauth = fs.readFileSync('mobile/src/platform/google-auth.ts', 'utf8');

function resolveConfig(appVariant, iconVariant = 'existing', present = false) {
  const context = {
    module: { exports: {} },
    process: { env: { EXPO_PUBLIC_WORKLOG_APP_VARIANT: appVariant, WORKLOG_ICON_VARIANT: iconVariant } },
    __dirname: '/mobile',
    require(moduleName) {
      if (moduleName === 'node:fs') return { existsSync() { return present; } };
      if (moduleName === 'node:path') return path;
      throw new Error('Unexpected dependency: ' + moduleName);
    },
  };
  vm.runInNewContext(source, context);
  return context.module.exports({ config: original });
}

test('default production identity is unchanged and QA is a side-by-side installation', () => {
  const production = resolveConfig(undefined);
  const qa = resolveConfig('qa');
  assert.equal(production, original);
  assert.equal(production.android.package, 'com.cetin072.worklog');
  assert.equal(production.scheme, 'worklog');
  assert.equal(qa.android.package, 'com.cetin072.worklog.qa');
  assert.equal(qa.name, '업무수첩 QA');
  assert.equal(qa.scheme, 'worklog-qa');
  assert.equal(qa.android.versionCode, original.android.versionCode);
  assert.equal(qa.android.permissions.join(','), original.android.permissions.join(','));
  assert.equal(qa.icon, original.icon);
  assert.equal(original.android.package, 'com.cetin072.worklog');
});

test('QA build never requires unavailable QA icon bytes', () => {
  assert.equal(resolveConfig('qa').android.package, 'com.cetin072.worklog.qa');
  assert.throws(() => resolveConfig('qa', 'qa'), /not available locally/);
  assert.throws(() => resolveConfig('oops'), /must be production or qa/);
});

test('OAuth callback scheme is unique and production route still exists', () => {
  assert.match(oauth, /EXPO_PUBLIC_WORKLOG_APP_VARIANT === 'qa'/);
  assert.match(oauth, /'worklog-qa:\/\/google-auth'/);
  assert.match(oauth, /'worklog:\/\/google-auth'/);
  assert.match(oauth, /new URL\(MOBILE_AUTH_CALLBACK_URL\)\.protocol/);
});

test('dedicated QA workflow sets identity for native and JS, checks APK package, and emulator uses that identity', () => {
  assert.match(workflow, /startsWith\(github\.ref, 'refs\/heads\/qa\/android-side-by-side-'\)/);
  assert.match(workflow, /EXPO_PUBLIC_WORKLOG_APP_VARIANT:/);
  assert.match(workflow, /expectedPackage = process\.env\.EXPO_PUBLIC_WORKLOG_APP_VARIANT === 'qa'/);
  assert.match(workflow, /worklog-mobile-side-by-side-qa-arm64-apk/);
  assert.match(smoke, /EXPO_PUBLIC_WORKLOG_APP_VARIANT:-production/);
  assert.match(smoke, /PACKAGE="com\.cetin072\.worklog\.qa"/);
});
