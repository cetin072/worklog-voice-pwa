#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/mobile/android"
APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
PACKAGE="com.cetin072.worklog"
ACTIVITY="$PACKAGE/.MainActivity"

cd "$ANDROID_DIR"
# A debug APK expects a Metro server. The release APK packages the JavaScript
# bundle, so this is an actual offline app-runtime check in CI.
./gradlew assembleRelease -PreactNativeArchitectures=x86_64 --no-daemon

adb install -r "$APK"
adb shell am force-stop "$PACKAGE" || true
adb shell am start -W -n "$ACTIVITY"
sleep 8

adb shell pidof "$PACKAGE"
# `am start -W` verifies the requested activity launches. Android 35's
# window-focus dump label varies across emulator images, so the reliable UI
# assertion is the rendered accessibility tree below instead of an internal
# focus field.
WINDOW_XML=/tmp/worklog-window.xml
for attempt in 1 2 3; do
  adb shell uiautomator dump /sdcard/worklog-window.xml >/dev/null
  adb pull /sdcard/worklog-window.xml "$WINDOW_XML" >/dev/null

  if grep -Eq '업무수첩|연결을 확인해주세요' "$WINDOW_XML"; then
    echo "Android runtime smoke PASS: app process alive and first screen rendered."
    exit 0
  fi

  # API 35's launcher can show a transient Quickstep ANR dialog while the
  # newly installed app takes foreground. Dismiss only that system dialog,
  # then re-read the app UI; any app error still fails below.
  if grep -q "Quickstep isn't responding" "$WINDOW_XML"; then
    adb shell input keyevent 4
  fi
  sleep 3
done

echo "Expected first-screen text was not found after retrying the rendered UI."
echo "---- Window XML ----"
cat "$WINDOW_XML"
echo "---- Recent logcat ----"
adb logcat -d -t 300 | grep -E "$PACKAGE|ReactNativeJS|AndroidRuntime" || true
exit 1
