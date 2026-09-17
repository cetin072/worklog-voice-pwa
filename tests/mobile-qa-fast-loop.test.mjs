import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('mobile/package.json', 'utf8'));
const readme = fs.readFileSync('mobile/README.md', 'utf8');
const plan = fs.readFileSync('docs/planning/MOBILE_QA_FAST_LOOP_V1.md', 'utf8');

test('Mobile QA fast loop exposes local device scripts without adding a new native dependency', () => {
  assert.equal(packageJson.scripts['android:device'], 'expo run:android --device');
  assert.equal(packageJson.scripts['start:device'], 'expo start --dev-client');
  assert.equal(packageJson.dependencies['expo-dev-client'], undefined);
  assert.equal(packageJson.dependencies['expo-updates'], undefined);
});

test('Mobile QA docs distinguish Metro reuse from native rebuild boundaries', () => {
  assert.match(readme, /빠른 실기기 QA 루프/);
  assert.match(readme, /native dependency/);
  assert.match(readme, /milestone Human QA/);
  assert.match(plan, /development build 재생성/);
  assert.match(plan, /Human QA 차등 검수/);
  assert.match(plan, /production OTA/);
});
