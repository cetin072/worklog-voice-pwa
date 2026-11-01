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
  calendar_captured=false
  for page in 1 2 3; do
    adb shell input swipe "$((width / 2))" 660 "$((width / 2))" 220 500
    adb shell uiautomator dump /sdcard/home-capture.xml >/dev/null
    adb pull /sdcard/home-capture.xml "$output/$name-page-$page.xml" >/dev/null
    adb exec-out screencap -p > "$output/$name-page-$page.png"
    if [[ "$calendar_captured" == false ]]; then
      point=$(python3 - "$output/$name-page-$page.xml" <<'PYXML'
import re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1])
dock_labels = {'음성 기록 시작', '음성 기록 종료 후 바로 저장', '업무 직접 입력 열기', '녹음 취소'}
dock_top = min((int(re.findall(r'\d+', n.get('bounds'))[1]) for n in root.iter('node') if n.get('content-desc') in dock_labels), default=810)
for node in root.iter('node'):
    if node.get('text') == 'Google 캘린더 · 연결 준비':
        x1,y1,x2,y2 = map(int,re.findall(r'\d+',node.get('bounds')))
        # Scroll farther if the actual floating controls cover this target.
        if y1 > 0 and y2 < min(810, dock_top - 8):
            print((x1+x2)//2,(y1+y2)//2)
            break
PYXML
)
      if [[ -n "$point" ]]; then
        read -r x y <<< "$point"
        adb shell input tap "$x" "$y"
        adb shell uiautomator dump /sdcard/calendar-preview.xml >/dev/null
        adb pull /sdcard/calendar-preview.xml "$output/$name-calendar.xml" >/dev/null
        grep -q 'Google 캘린더에 추가' "$output/$name-calendar.xml"
        adb exec-out screencap -p > "$output/$name-calendar.png"
        adb shell input keyevent KEYCODE_BACK
        calendar_captured=true
      fi
    fi
  done
  [[ "$calendar_captured" == true ]]
  grep -q '알림 확인 필요' "$output/$name-"*.xml
done
