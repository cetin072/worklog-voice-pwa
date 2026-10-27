#!/usr/bin/env bash
set -euo pipefail
# Synthetic emulator only. Never run against a user's phone or distribute this APK.
variant="${1:?production or qa}"
output="${2:?capture directory}"
mkdir -p "$output"
adb shell am force-stop com.cetin072.worklog
adb shell input keyevent KEYCODE_HOME
# Synchronize with the home activity before sending the all-apps gesture. Without
# this dump, a gesture sent during HOME transition can be discarded by Launcher3.
adb shell uiautomator dump /sdcard/launcher-home.xml >/dev/null
adb shell input keyevent KEYCODE_ALL_APPS
for attempt in $(seq 1 12); do
  adb shell uiautomator dump /sdcard/launcher.xml >/dev/null
  adb pull /sdcard/launcher.xml "$output/launcher-$variant.xml" >/dev/null
  adb exec-out screencap -p > "$output/launcher-$variant.png"
  if grep -q '업무수첩' "$output/launcher-$variant.xml"; then
    echo "Actual launcher capture: $variant"
    exit 0
  fi
  # Some launchers ignore the all-apps key. Only gesture when fresh XML proves
  # that the workspace is still visible; do not swipe a partially opened drawer.
  if grep -q 'com.android.launcher3:id/workspace' "$output/launcher-$variant.xml"; then
    adb shell input swipe 540 2200 540 600 600
  fi
  sleep 1
done
echo "Launcher did not expose the installed 업무수첩 icon" >&2
exit 1
