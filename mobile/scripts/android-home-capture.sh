#!/usr/bin/env bash
set -euo pipefail
# Disposable synthetic CI emulator only; never attach a user's device.
output="${1:?capture directory}"
mkdir -p "$output"
app_package=com.cetin072.worklog
if [[ "${EXPO_PUBLIC_WORKLOG_APP_VARIANT:-production}" == "qa" ]]; then
  app_package=com.cetin072.worklog.qa
fi
restore() {
  adb shell settings put system font_scale 1.0 >/dev/null || true
  adb shell wm size reset >/dev/null || true
  adb shell wm density reset >/dev/null || true
}
trap restore EXIT
for spec in '320 1.0' '390 1.0' '320 1.4'; do
  read -r width scale <<<"$spec"
  name="home-${width}-font-${scale}"
  adb shell am force-stop "$app_package"
  adb shell wm density 160
  adb shell wm size "${width}x900"
  adb shell settings put system font_scale "$scale"
  adb shell am start -W -n "$app_package/.MainActivity" >/dev/null
  for attempt in $(seq 1 12); do
    adb shell uiautomator dump /sdcard/home-capture.xml >/dev/null
    adb pull /sdcard/home-capture.xml "$output/$name-top.xml" >/dev/null
    if grep -q '오늘 한눈에' "$output/$name-top.xml"; then break; fi
    sleep 1
  done
  grep -q '오늘 한눈에' "$output/$name-top.xml"
  grep -q '음성 기록 시작' "$output/$name-top.xml"
  adb exec-out screencap -p > "$output/$name-top.png"
  for page in 1 2 3; do
    adb shell input swipe "$((width / 2))" 660 "$((width / 2))" 220 500
    adb shell uiautomator dump /sdcard/home-capture.xml >/dev/null
    adb pull /sdcard/home-capture.xml "$output/$name-page-$page.xml" >/dev/null
    adb exec-out screencap -p > "$output/$name-page-$page.png"
  done
  grep -q '알림 확인 필요' "$output/$name-"*.xml
  # Connection belongs to Settings; disconnected schedules have no Calendar CTA.
  if grep -q 'Google 캘린더 · 연결 준비' "$output/$name-"*.xml; then exit 1; fi
  for page in 1 2 3 4; do
    adb shell input swipe "$((width / 2))" 220 "$((width / 2))" 660 300
  done
  adb shell uiautomator dump /sdcard/home-capture.xml >/dev/null
  adb pull /sdcard/home-capture.xml "$output/$name-settings-entry.xml" >/dev/null
  point=$(python3 - "$output/$name-settings-entry.xml" <<'PYXML'
import re, sys, xml.etree.ElementTree as ET
for node in ET.parse(sys.argv[1]).iter('node'):
    if node.get('content-desc') == '설정 열기':
        x1,y1,x2,y2 = map(int,re.findall(r'\d+',node.get('bounds')))
        print((x1+x2)//2,(y1+y2)//2)
        break
PYXML
)
  [[ -n "$point" ]]
  read -r x y <<< "$point"
  adb shell input tap "$x" "$y"
  calendar_captured=false
  for page in 0 1 2 3 4; do
    adb shell uiautomator dump /sdcard/calendar-settings.xml >/dev/null
    adb pull /sdcard/calendar-settings.xml "$output/$name-calendar-settings-$page.xml" >/dev/null
    if grep -q 'Google 캘린더 연결' "$output/$name-calendar-settings-$page.xml"; then
      grep -q '연결 안 됨' "$output/$name-calendar-settings-$page.xml"
      adb exec-out screencap -p > "$output/$name-calendar-settings.png"
      calendar_captured=true
      break
    fi
    adb shell input swipe "$((width / 2))" 660 "$((width / 2))" 300 500
  done
  [[ "$calendar_captured" == true ]]
done
