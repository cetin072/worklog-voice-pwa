#!/usr/bin/env bash
set -euo pipefail

if [[ "${EXPO_PUBLIC_WORKLOG_APP_VARIANT:-}" != 'qa' ]]; then
  echo 'Standalone CI APKs must use the QA app identity, never the Play identity.' >&2
  exit 1
fi
apk="${1:?APK path required}"
analyzer="${ANDROID_HOME:?ANDROID_HOME required}/cmdline-tools/latest/bin/apkanalyzer"
actual="$("$analyzer" manifest application-id "$apk")"
if [[ "$actual" != 'com.cetin072.worklog.qa' ]]; then
  echo "Refusing non-Play APK with identity $actual" >&2
  exit 1
fi
printf 'CI QA APK identity verified: %s\n' "$actual"
