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

dump_window() {
  local remote="$1"
  local local_path="$2"
  adb shell uiautomator dump "$remote" >/dev/null
  adb pull "$remote" "$local_path" >/dev/null
}

find_password_toggle_center() {
  python3 - "$1" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
for node in root.iter("node"):
    text = node.attrib.get("text", "")
    description = node.attrib.get("content-desc", "")
    if text != "보기" and description != "비밀번호 보기":
        continue
    bounds = node.attrib.get("bounds", "")
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if not match:
        continue
    x1, y1, x2, y2 = map(int, match.groups())
    print((x1 + x2) // 2, (y1 + y2) // 2)
    raise SystemExit(0)
raise SystemExit(1)
PY
}

password_toggle_changed() {
  python3 - "$1" <<'PY'
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
for node in root.iter("node"):
    text = node.attrib.get("text", "")
    description = node.attrib.get("content-desc", "")
    if text == "숨기기" or description == "비밀번호 숨기기":
        raise SystemExit(0)
raise SystemExit(1)
PY
}

find_quickstep_wait_center() {
  python3 - "$1" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
for node in root.iter("node"):
    if node.attrib.get("resource-id") != "android:id/aerr_wait" and node.attrib.get("text") != "Wait":
        continue
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
    if not match:
        continue
    x1, y1, x2, y2 = map(int, match.groups())
    print((x1 + x2) // 2, (y1 + y2) // 2)
    raise SystemExit(0)
raise SystemExit(1)
PY
}

rendered=0
for attempt in 1 2 3 4 5 6; do
  dump_window /sdcard/worklog-window.xml "$WINDOW_XML"

  if grep -Eq '업무수첩|연결을 확인해주세요' "$WINDOW_XML"; then
    rendered=1
    break
  fi

  # API 35's launcher can show a transient Quickstep ANR dialog while the
  # newly installed app takes foreground. Explicitly choose "Wait" on that
  # system dialog, then foreground the app again before re-reading its UI.
  if grep -q "Quickstep isn't responding" "$WINDOW_XML"; then
    if WAIT_COORDS="$(find_quickstep_wait_center "$WINDOW_XML")"; then
      read -r WAIT_X WAIT_Y <<<"$WAIT_COORDS"
      adb shell input tap "$WAIT_X" "$WAIT_Y"
      sleep 2
      adb shell am start -W -n "$ACTIVITY" >/dev/null || true
    else
      echo "Quickstep ANR was visible but its Wait action could not be located."
      cat "$WINDOW_XML"
      exit 1
    fi
  fi
  sleep 3
done

if [[ "$rendered" != "1" ]]; then
  echo "Expected first-screen text was not found after retrying the rendered UI."
  echo "---- Window XML ----"
  cat "$WINDOW_XML"
  echo "---- Recent logcat ----"
  adb logcat -d -t 300 | grep -E "$PACKAGE|ReactNativeJS|AndroidRuntime" || true
  exit 1
fi

# Regression for #414: rendering is not enough. Exercise a real React Native
# Pressable through Android input and require a visible state change.
TAP_COORDS=""
for scroll_attempt in 0 1 2 3; do
  dump_window /sdcard/worklog-touch-before.xml /tmp/worklog-touch-before.xml
  if TAP_COORDS="$(find_password_toggle_center /tmp/worklog-touch-before.xml)"; then
    break
  fi
  adb shell input swipe 540 1600 540 600 300
  sleep 1
done

if [[ -z "$TAP_COORDS" ]]; then
  echo "Could not locate the password visibility Pressable in the Android accessibility tree."
  echo "---- Window XML ----"
  cat /tmp/worklog-touch-before.xml
  exit 1
fi

read -r TAP_X TAP_Y <<<"$TAP_COORDS"
adb shell input tap "$TAP_X" "$TAP_Y"
sleep 1

dump_window /sdcard/worklog-touch-after.xml /tmp/worklog-touch-after.xml
if ! password_toggle_changed /tmp/worklog-touch-after.xml; then
  echo "First-screen Pressable did not react to a real Android tap."
  echo "Tapped at: $TAP_X $TAP_Y"
  echo "---- Window XML after tap ----"
  cat /tmp/worklog-touch-after.xml
  exit 1
fi

echo "Android runtime smoke PASS: app rendered and a real Pressable tap reached React Native."
