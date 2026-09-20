#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/mobile/android"
APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
PACKAGE="com.cetin072.worklog"
ACTIVITY="$PACKAGE/.MainActivity"

cd "$ANDROID_DIR"
if [[ ! -f "$APK" ]]; then
  echo "Prebuilt authenticated-home touch APK is missing: $APK"
  exit 1
fi

# Suppress unrelated launcher ANR dialogs; the emulator is started only after
# the release APK is fully built, so app interaction is measured in isolation.
adb shell settings put global hide_error_dialogs 1 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true

adb install -r "$APK"
adb shell pm grant "$PACKAGE" android.permission.RECORD_AUDIO || true
adb shell am force-stop "$PACKAGE" || true
adb shell am start -W -n "$ACTIVITY"
sleep 8

adb shell pidof "$PACKAGE"
WINDOW_XML=/tmp/worklog-window.xml

dump_window() {
  local remote="$1"
  local local_path="$2"
  adb shell uiautomator dump "$remote" >/dev/null
  adb pull "$remote" "$local_path" >/dev/null
}

find_node_center() {
  python3 - "$1" "$2" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
needle = sys.argv[2]
for node in root.iter("node"):
    if node.attrib.get("text", "") != needle and node.attrib.get("content-desc", "") != needle:
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

  if grep -q 'ANDROID TOUCH SMOKE' "$WINDOW_XML"; then
    rendered=1
    break
  fi

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
  echo "Authenticated-home touch harness did not render."
  cat "$WINDOW_XML"
  adb logcat -d -t 300 | grep -E "$PACKAGE|ReactNativeJS|AndroidRuntime" || true
  exit 1
fi

# Tap a top authenticated-home button and require a React state change.
HEADER_COORDS="$(find_node_center "$WINDOW_XML" "QA 홈 상단 버튼")"
read -r HEADER_X HEADER_Y <<<"$HEADER_COORDS"
adb shell input tap "$HEADER_X" "$HEADER_Y"
sleep 1
dump_window /sdcard/worklog-header-after.xml /tmp/worklog-header-after.xml
if ! grep -q 'QA 홈 상단 PASS' /tmp/worklog-header-after.xml; then
  echo "Authenticated-home header Pressable did not react to Android tap."
  cat /tmp/worklog-header-after.xml
  exit 1
fi

# Tap the actual Quick Voice Pressable and require it to enter recording state.
MIC_COORDS="$(find_node_center /tmp/worklog-header-after.xml "음성 기록 시작")"
read -r MIC_X MIC_Y <<<"$MIC_COORDS"
adb shell input tap "$MIC_X" "$MIC_Y"
sleep 2
dump_window /sdcard/worklog-mic-after.xml /tmp/worklog-mic-after.xml
if ! grep -Eq '음성 기록 종료 후 바로 저장|녹음 중' /tmp/worklog-mic-after.xml; then
  echo "Authenticated-home Quick Voice Pressable did not enter recording state."
  echo "Tapped at: $MIC_X $MIC_Y"
  cat /tmp/worklog-mic-after.xml
  adb logcat -d -t 300 | grep -E "$PACKAGE|ReactNativeJS|AndroidRuntime|quick-voice" || true
  exit 1
fi

echo "Android authenticated-home touch smoke PASS: header and Quick Voice taps reached React Native."
