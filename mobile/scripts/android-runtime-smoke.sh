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
adb shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS || true
adb shell pm grant "$PACKAGE" android.permission.READ_CALENDAR || true
adb shell pm grant "$PACKAGE" android.permission.WRITE_CALENDAR || true
adb shell am force-stop "$PACKAGE" || true
adb logcat -c || true
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

  if grep -q '업무일지 열기' "$WINDOW_XML" && grep -q '음성 기록 시작' "$WINDOW_XML"; then
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
  echo "Production HomeScreenApp did not render its authenticated controls."
  cat "$WINDOW_XML"
  adb logcat -d -t 300 | grep -E "$PACKAGE|ReactNativeJS|AndroidRuntime" || true
  exit 1
fi

# Tap the production header and require HomeScreenApp's real setScreen('journal')
# navigation, then return through the production panel close action.
HEADER_COORDS="$(find_node_center "$WINDOW_XML" "업무일지 열기")"
read -r HEADER_X HEADER_Y <<<"$HEADER_COORDS"
adb shell input tap "$HEADER_X" "$HEADER_Y"
sleep 1
dump_window /sdcard/worklog-header-after.xml /tmp/worklog-header-after.xml
if ! grep -q '업무일지' /tmp/worklog-header-after.xml || ! grep -q '닫기' /tmp/worklog-header-after.xml; then
  echo "HomeScreenApp did not navigate to the production journal screen."
  cat /tmp/worklog-header-after.xml
  exit 1
fi

CLOSE_COORDS="$(find_node_center /tmp/worklog-header-after.xml "닫기")"
read -r CLOSE_X CLOSE_Y <<<"$CLOSE_COORDS"
adb shell input tap "$CLOSE_X" "$CLOSE_Y"
sleep 1
dump_window /sdcard/worklog-home-return.xml /tmp/worklog-home-return.xml
if ! grep -q '음성 기록 시작' /tmp/worklog-home-return.xml; then
  echo "Production journal close did not return to HomeScreenApp."
  cat /tmp/worklog-home-return.xml
  exit 1
fi

# Tap the actual Quick Voice Pressable. Audio streaming keeps React Native busy
# enough that uiautomator may not produce a post-tap XML dump, so verify the
# VoiceRecorderCard's state transition through the release runtime log instead.
MIC_COORDS="$(find_node_center /tmp/worklog-home-return.xml "음성 기록 시작")"
read -r MIC_X MIC_Y <<<"$MIC_COORDS"
adb shell input tap "$MIC_X" "$MIC_Y"
recording=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if adb logcat -d -v brief | grep -q 'quick-voice-phase=recording'; then
    recording=1
    break
  fi
  sleep 1
done
if [[ "$recording" != "1" ]]; then
  echo "HomeScreenApp Quick Voice Pressable did not enter recording state."
  echo "Tapped at: $MIC_X $MIC_Y"
  adb logcat -d -t 300 | grep -E "$PACKAGE|ReactNativeJS|AndroidRuntime|quick-voice" || true
  exit 1
fi

# The CI-only timer freeze keeps this rendered state idle. Require the actual
# mic accessibility node to change; a click/console event alone is insufficient.
dump_window /sdcard/worklog-mic-after.xml /tmp/worklog-mic-after.xml
if ! grep -Eq '음성 기록 종료 후 바로 저장|녹음 중' /tmp/worklog-mic-after.xml; then
  echo "HomeScreenApp Quick Voice recording UI did not render after Android tap."
  cat /tmp/worklog-mic-after.xml
  exit 1
fi

CANCEL_COORDS="$(find_node_center /tmp/worklog-mic-after.xml "녹음 취소")"
read -r CANCEL_X CANCEL_Y <<<"$CANCEL_COORDS"
adb shell input tap "$CANCEL_X" "$CANCEL_Y"
sleep 1
dump_window /sdcard/worklog-cancel-after.xml /tmp/worklog-cancel-after.xml
if ! grep -q '음성 기록 시작' /tmp/worklog-cancel-after.xml; then
  echo "Quick Voice cancel did not return HomeScreenApp recorder to idle."
  cat /tmp/worklog-cancel-after.xml
  exit 1
fi

# After cancellation, exercise the same production navigation path again.
HEADER_COORDS="$(find_node_center /tmp/worklog-cancel-after.xml "업무일지 열기")"
read -r HEADER_X HEADER_Y <<<"$HEADER_COORDS"
adb shell input tap "$HEADER_X" "$HEADER_Y"
sleep 1
dump_window /sdcard/worklog-header-retry.xml /tmp/worklog-header-retry.xml
if ! grep -q '업무일지' /tmp/worklog-header-retry.xml || ! grep -q '닫기' /tmp/worklog-header-retry.xml; then
  echo "HomeScreenApp did not navigate after Quick Voice cancellation."
  cat /tmp/worklog-header-retry.xml
  exit 1
fi

echo "Android production HomeScreenApp E2E PASS: navigation, Quick Voice recording, cancel, and post-cancel navigation."
