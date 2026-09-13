export const HOME_FOLD_DEFAULT = Object.freeze({
  COLLAPSED: "collapsed",
  EXPANDED: "expanded",
});

export const HOME_FOLD_STORAGE_KEY = "worklog.ui.homeFoldDefault.v1";

export function normalizeHomeFoldDefault(value) {
  return value === HOME_FOLD_DEFAULT.EXPANDED
    ? HOME_FOLD_DEFAULT.EXPANDED
    : HOME_FOLD_DEFAULT.COLLAPSED;
}

export function loadHomeFoldDefault(storage = globalThis.localStorage) {
  try {
    return normalizeHomeFoldDefault(storage?.getItem(HOME_FOLD_STORAGE_KEY));
  } catch {
    return HOME_FOLD_DEFAULT.COLLAPSED;
  }
}

export function saveHomeFoldDefault(value, storage = globalThis.localStorage) {
  const normalized = normalizeHomeFoldDefault(value);
  try {
    storage?.setItem(HOME_FOLD_STORAGE_KEY, normalized);
  } catch {
    // UI 편의 설정 저장 실패는 앱 핵심 기능을 막지 않는다.
  }
  return normalized;
}
