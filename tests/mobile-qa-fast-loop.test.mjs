import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('mobile/package.json', 'utf8'));
const readme = fs.readFileSync('mobile/README.md', 'utf8');
const plan = fs.readFileSync('docs/planning/MOBILE_QA_FAST_LOOP_V1.md', 'utf8');
const workflow = fs.readFileSync('.github/workflows/mobile-foundation.yml', 'utf8');
const smokeScript = fs.readFileSync('mobile/scripts/android-runtime-smoke.sh', 'utf8');
const appShell = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('Mobile QA fast loop exposes local device scripts without adding a new native dependency', () => {
  assert.equal(packageJson.scripts['android:device'], 'expo run:android --device');
  assert.equal(packageJson.scripts['start:device'], 'expo start --dev-client');
  assert.equal(packageJson.dependencies['expo-dev-client'], undefined);
  assert.equal(packageJson.dependencies['expo-updates'], undefined);
});

test('Mobile QA docs distinguish Metro reuse from native rebuild boundaries', () => {
  assert.match(readme, /빠른 실기기 QA 루프/);
  assert.match(readme, /native dependency/);
  assert.match(plan, /standalone ARM64 APK|Release APK|Human QA/);
  assert.match(plan, /development build 재생성/);
  assert.match(plan, /Human QA 차등 검수/);
  assert.match(plan, /production OTA/);
});


test('Mobile CI bundles and runtime-smokes app code changes while retaining manual build control', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /Detect native Android build scope/);
  assert.match(workflow, /'mobile\/app\/\*\*'/);
  assert.match(workflow, /'mobile\/src\/\*\*'/);
  assert.match(workflow, /mobile\/\(app\/\|src\//);
  assert.match(workflow, /Bundle Android app with Metro/);
  assert.match(workflow, /android-runtime-smoke:/);
  assert.match(workflow, /android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d/);
  assert.match(workflow, /bash mobile\/scripts\/android-runtime-smoke\.sh/);
  assert.match(smokeScript, /adb shell am start -W -n "\$ACTIVITY"/);
  assert.match(workflow, /Build x86_64 authenticated-home recovery touch APK/);
  assert.match(workflow, /EXPO_PUBLIC_ANDROID_TOUCH_RECOVERY_SMOKE: '1'/);
  assert.match(workflow, /EXPO_PUBLIC_ANDROID_TOUCH_DIRTY_RECOVERY: '1'/);
  assert.match(workflow, /EXPO_PUBLIC_ANDROID_TOUCH_RECOVERY_CANCELLED: '0'/);
  assert.match(appShell, /ensureAndroidTouchDirtyRecoverySeed/);
  assert.match(appShell, /seedAndroidTouchDirtyRecoveryFixture/);
  assert.match(workflow, /assembleRelease -PreactNativeArchitectures=x86_64/);
  assert.match(smokeScript, /app-release\.apk/);
  assert.match(smokeScript, /uiautomator dump/);
  assert.match(smokeScript, /for attempt in 1 2 3/);
  assert.match(smokeScript, /Quickstep isn't responding/);
  assert.match(appShell, /HomeScreenApp androidTouchSmoke=.*androidTouchRecoverySmoke/);
  assert.match(appShell, /ANDROID_TOUCH_SMOKE_SESSION/);
  assert.match(appShell, /ANDROID_TOUCH_SMOKE_BRIEFING/);
  assert.match(appShell, /scheduleEnabled: true/);
  assert.match(appShell, /android-touch-schedule-today/);
  assert.match(appShell, /android-touch-schedule-upcoming/);
  assert.match(appShell, /ANDROID_TOUCH_RECOVERY_SMOKE_MODE/);
  assert.match(appShell, /ANDROID_TOUCH_RECOVERY_CANCELLED/);
  assert.match(appShell, /ANDROID_TOUCH_RECOVERY_CALENDAR/);
  assert.match(appShell, /ANDROID_TOUCH_RECOVERY_REMINDERS/);
  assert.match(appShell, /\[android-touch-recovery\]/);
  assert.match(appShell, /const touchSmoke = androidTouchSmoke \|\| androidTouchRecoverySmoke/);
  assert.match(appShell, /reconcileHomeReminders = androidTouchSmoke \|\| \(androidTouchRecoverySmoke && !ANDROID_TOUCH_RECOVERY_REMINDERS\)/);
  assert.doesNotMatch(appShell, /AuthenticatedHomeTouchSmoke/);
  assert.match(appShell, /onQuickVoicePhaseChange/);
  assert.match(appShell, /freezeQuickVoiceTimer/);
  assert.match(smokeScript, /업무일지 열기/);
  assert.match(smokeScript, /음성 기록 시작/);
  assert.match(smokeScript, /android.permission.POST_NOTIFICATIONS/);
  assert.match(smokeScript, /android.permission.READ_CALENDAR/);
  assert.match(smokeScript, /android.permission.WRITE_CALENDAR/);
  assert.match(smokeScript, /adb shell input tap/);
  assert.match(smokeScript, /quick-voice-phase=recording/);
  assert.match(smokeScript, /음성 기록 종료 후 바로 저장\|녹음 중/);
  assert.match(smokeScript, /녹음 취소/);
  assert.match(smokeScript, /production journal screen/);
  assert.match(smokeScript, /Production journal close did not return to HomeScreenApp/);
  assert.match(smokeScript, /did not navigate after Quick Voice cancellation/);
  assert.match(smokeScript, /Android production HomeScreenApp E2E PASS/);
  assert.match(workflow, /Build standalone ARM64 APK/);
});
