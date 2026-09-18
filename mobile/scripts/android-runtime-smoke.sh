#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/mobile/android"
APK="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="com.cetin072.worklog"
ACTIVITY="$PACKAGE/.MainActivity"

cd "$ANDROID_DIR"
./gradlew assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon

adb install -r "$APK"
adb shell am force-stop "$PACKAGE" || true
adb shell am start -W -n "$ACTIVITY"
sleep 8

adb shell pidof "$PACKAGE"
adb shell dumpsys activity activities | grep -q "mResumedActivity.*$PACKAGE"

adb shell uiautomator dump /sdcard/worklog-window.xml >/dev/null
adb pull /sdcard/worklog-window.xml /tmp/worklog-window.xml >/dev/null

if ! grep -Eq '업무수첩|연결을 확인해주세요' /tmp/worklog-window.xml; then
  echo "Expected first-screen text was not found."
  echo "---- Window XML ----"
  cat /tmp/worklog-window.xml
  echo "---- Recent logcat ----"
  adb logcat -d -t 300 | grep -E "$PACKAGE|ReactNativeJS|AndroidRuntime" || true
  exit 1
fi

echo "Android runtime smoke PASS: app process alive and first screen rendered."
