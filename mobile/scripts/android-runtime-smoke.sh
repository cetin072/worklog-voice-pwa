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
    if grep -q 'text="보기"' "$WINDOW_XML"; then
      BOUNDS=$(python3 - "$WINDOW_XML" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8').read()
match = re.search(r'text="보기"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"', xml)
if not match:
    match = re.search(r'bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^>]*text="보기"', xml)
if not match:
    raise SystemExit(1)
x1, y1, x2, y2 = map(int, match.groups())
print((x1 + x2) // 2, (y1 + y2) // 2)
PY
      )
      read -r TAP_X TAP_Y <<<"$BOUNDS"
      adb shell input tap "$TAP_X" "$TAP_Y"
      sleep 1
      adb shell uiautomator dump /sdcard/worklog-window-after-tap.xml >/dev/null
      adb pull /sdcard/worklog-window-after-tap.xml /tmp/worklog-window-after-tap.xml >/dev/null
      if ! grep -q 'text="숨기기"' /tmp/worklog-window-after-tap.xml; then
        echo "First-screen Pressable did not react to a real Android tap."
        cat /tmp/worklog-window-after-tap.xml
        exit 1
      fi
    fi
    echo "Android runtime smoke PASS: app rendered and a real Pressable tap reached React Native."
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
