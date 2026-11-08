import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { appBuildInfo } = await import('../mobile/src/features/settings/app-build-info.ts');

test('QA bundle is visibly differentiated and never claims Play update eligibility', () => {
  const qa = appBuildInfo({
    version: '0.1.0', android: { package: 'com.cetin072.worklog.qa' },
  });
  assert.equal(qa.label, '업무수첩 QA · 설정 버전 0.1.0');
  assert.match(qa.help, /정식 Play 스토어 업데이트 안내 대상이 아닙니다/);
});

test('Play package label does not invent installed build number or update availability', () => {
  const play = appBuildInfo({
    version: '0.1.0', android: { package: 'com.cetin072.worklog', versionCode: 1 },
  });
  assert.equal(play.label, '업무수첩 Play용 · 설정 버전 0.1.0');
  assert.match(play.help, /Google Play가 해당 설치본의 업데이트 가능 여부를 확인했을 때만/);
  assert.doesNotMatch(play.label, /빌드|code 1|versionCode|최신|설치됨|업데이트 가능/);
});

test('missing runtime configuration remains unknown rather than being mislabeled Play', () => {
  const missing = appBuildInfo(null);
  assert.match(missing.label, /종류 확인 필요/);
  assert.match(missing.help, /확인하지 못했습니다/);
  assert.match(appBuildInfo({ android: { package: 'unrelated.package' } }).label, /종류 확인 필요/);
});

test('settings shows bundled identity with no new native dependencies or update hooks', () => {
  const home = readFileSync('mobile/app/index.tsx', 'utf8');
  const native = readFileSync('mobile/modules/worklog-play-update/android/src/main/java/expo/modules/worklogplayupdate/WorklogPlayUpdateModule.kt', 'utf8');
  const config = readFileSync('mobile/app.config.js', 'utf8');
  const updatePrompt = readFileSync('mobile/src/features/startup/app-update-prompt.tsx', 'utf8');
  assert.match(home, /appBuildInfo\(Constants\.expoConfig\)/);
  assert.match(home, /APP_BUILD_INFO\.label/);
  assert.match(home, /APP_BUILD_INFO\.help/);
  assert.match(config, /package: 'com\.cetin072\.worklog\.qa'/);
  assert.match(native, /context\.packageName != "com\.cetin072\.worklog"/);
  assert.match(updatePrompt, /updateSession\.check\(\)/);
  assert.match(updatePrompt, /updateSession\.dismiss\(\)/);
});
