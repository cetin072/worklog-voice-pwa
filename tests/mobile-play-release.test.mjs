import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appConfig = JSON.parse(readFileSync(new URL('../mobile/app.json', import.meta.url), 'utf8')).expo;
const plugin = readFileSync(new URL('../mobile/plugins/with-worklog-play-signing.js', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/play-android-aab.yml', import.meta.url), 'utf8');
const mobileGitignore = readFileSync(new URL('../mobile/.gitignore', import.meta.url), 'utf8');

test('Play identity pins the existing package and an explicit positive versionCode', () => {
  assert.equal(appConfig.name, '업무수첩');
  assert.equal(appConfig.android.package, 'com.cetin072.worklog');
  assert.equal(appConfig.version, '0.1.0');
  assert.equal(appConfig.android.versionCode, 1);
  assert.ok(appConfig.plugins.includes('./plugins/with-worklog-play-signing.js'));
});

test('Play signing is opt-in and reads all credential material from environment variables', () => {
  assert.match(plugin, /WORKLOG_PLAY_SIGNING/);
  assert.match(plugin, /System\.getenv\("WORKLOG_PLAY_KEYSTORE_PATH"\)/);
  assert.match(plugin, /System\.getenv\("WORKLOG_PLAY_STORE_PASSWORD"\)/);
  assert.match(plugin, /System\.getenv\("WORKLOG_PLAY_KEY_ALIAS"\)/);
  assert.match(plugin, /System\.getenv\("WORKLOG_PLAY_KEY_PASSWORD"\)/);
  assert.match(plugin, /signingConfigs\.create\("worklogPlayRelease"\)/);
  assert.match(plugin, /buildTypes\.getByName\("release"\)\.signingConfig/);
  assert.doesNotMatch(plugin, /storePassword\s*=\s*["'][^"']+["']/);
  assert.doesNotMatch(plugin, /keyPassword\s*=\s*["'][^"']+["']/);
});

test('Play workflow produces a production signed AAB without QA-only ABI or runtime flags', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /EXPO_PUBLIC_API_BASE_URL: https:\/\/worklog-voice-pwa\.netlify\.app/);
  assert.match(workflow, /\.\/gradlew bundleRelease --no-daemon/);
  assert.doesNotMatch(workflow, /bundleRelease[^\n]*PreactNativeArchitectures/);
  assert.match(workflow, /mobile\/android\/app\/build\/outputs\/bundle\/release\/app-release\.aab/);
  assert.match(workflow, /EXPO_PUBLIC_ANDROID_TOUCH_SMOKE/);
  assert.match(workflow, /EXPO_PUBLIC_FORCE_WHISPER_FALLBACK_QA/);
  assert.doesNotMatch(workflow, /EXPO_PUBLIC_ANDROID_TOUCH_SMOKE:\s*['"]?1/);
  assert.doesNotMatch(workflow, /EXPO_PUBLIC_FORCE_WHISPER_FALLBACK_QA:\s*['"]?1/);
});

test('Play workflow requires the dedicated upload-key secret set', () => {
  for (const name of [
    'PLAY_UPLOAD_KEYSTORE_BASE64',
    'PLAY_UPLOAD_STORE_PASSWORD',
    'PLAY_UPLOAD_KEY_ALIAS',
    'PLAY_UPLOAD_KEY_PASSWORD',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${name}`));
  }
});

test('keystore file formats remain excluded from source control', () => {
  assert.match(mobileGitignore, /^\*\.jks$/m);
  assert.match(mobileGitignore, /^\*\.keystore$/m);
});
