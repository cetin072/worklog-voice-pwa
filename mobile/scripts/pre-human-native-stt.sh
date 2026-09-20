#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/mobile/android"
APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
PACKAGE="com.cetin072.worklog"

cd "$ANDROID_DIR"
./gradlew assembleRelease -PreactNativeArchitectures=x86_64 --no-daemon

adb install -r "$APK"
adb shell am force-stop "$PACKAGE" || true
adb shell am start -W -a android.intent.action.VIEW -d 'worklog://prehuman-stt' -p "$PACKAGE"

WINDOW_XML=/tmp/prehuman.xml
for attempt in $(seq 1 150); do
  adb shell uiautomator dump /sdcard/prehuman.xml >/dev/null 2>&1 || true
  adb pull /sdcard/prehuman.xml "$WINDOW_XML" >/dev/null 2>&1 || true

  if grep -q 'PREHUMAN STT PASS' "$WINDOW_XML" 2>/dev/null; then
    echo 'Pre-Human native Korean STT PASS'
    grep -o 'text="[^"]*"' "$WINDOW_XML" | tail -20 || true
    adb logcat -d -t 800 | grep -E 'PREHUMAN_STT_PASS|ReactNativeJS|quick-voice' | tail -150 || true
    exit 0
  fi

  if grep -q 'PREHUMAN STT FAIL' "$WINDOW_XML" 2>/dev/null; then
    echo 'Pre-Human native Korean STT FAIL'
    cat "$WINDOW_XML" || true
    adb logcat -d -t 1200 | grep -E 'PREHUMAN_STT_FAIL|PREHUMAN_STT_PASS|ReactNativeJS|AndroidRuntime|rnwhisper|quick-voice' | tail -400 || true
    exit 1
  fi

  if grep -q "Quickstep isn't responding" "$WINDOW_XML" 2>/dev/null; then
    adb shell input keyevent 4 || true
  fi
  sleep 6
done

echo 'Timed out waiting for native Korean STT result.'
cat "$WINDOW_XML" 2>/dev/null || true
adb logcat -d -t 1500 | grep -E 'PREHUMAN_STT_FAIL|PREHUMAN_STT_PASS|ReactNativeJS|AndroidRuntime|rnwhisper|quick-voice' | tail -500 || true
exit 1
