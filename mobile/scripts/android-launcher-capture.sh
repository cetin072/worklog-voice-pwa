#!/usr/bin/env bash
set -euo pipefail
# Synthetic emulator only. Never run against a user's phone or distribute this APK.
variant="${1:?production or qa}"
output="${2:?capture directory}"
mkdir -p "$output"
adb shell am force-stop com.cetin072.worklog
adb shell input keyevent KEYCODE_HOME
adb shell input swipe 540 1800 540 400 450
for attempt in $(seq 1 12); do
  adb shell uiautomator dump /sdcard/launcher.xml >/dev/null
  adb pull /sdcard/launcher.xml "$output/launcher-$variant.xml" >/dev/null
  if grep -q '업무수첩' "$output/launcher-$variant.xml"; then
    adb exec-out screencap -p > "$output/launcher-$variant.png"
    echo "Actual launcher capture: $variant"
    exit 0
  fi
  sleep 1
done
echo "Launcher did not expose the installed 업무수첩 icon" >&2
exit 1
