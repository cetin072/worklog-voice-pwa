export const HOME_FOLD_DEFAULT = Object.freeze({
  COLLAPSED: "collapsed",
  EXPANDED: "expanded",
});

export const HOME_FOLD_SECTION = Object.freeze({
  CALLS: "calls",
  BRIEFING: "briefing",
});

export const HOME_FOLD_STORAGE_KEY = "worklog.ui.homeFoldDefaults.v2";
export const LEGACY_HOME_FOLD_STORAGE_KEY = "worklog.ui.homeFoldDefault.v1";

export function normalizeHomeFoldDefault(value) {
  return value === HOME_FOLD_DEFAULT.EXPANDED
    ? HOME_FOLD_DEFAULT.EXPANDED
    : HOME_FOLD_DEFAULT.COLLAPSED;
}

function defaultStateFromLegacy(storage) {
  try {
    return normalizeHomeFoldDefault(storage?.getItem(LEGACY_HOME_FOLD_STORAGE_KEY));
  } catch {
    return HOME_FOLD_DEFAULT.COLLAPSED;
  }
}

export function loadHomeFoldDefaults(storage = globalThis.localStorage) {
  const legacy = defaultStateFromLegacy(storage);
  try {
    const raw = storage?.getItem(HOME_FOLD_STORAGE_KEY);
    if (!raw) {
      return {
        [HOME_FOLD_SECTION.CALLS]: legacy,
        [HOME_FOLD_SECTION.BRIEFING]: legacy,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      [HOME_FOLD_SECTION.CALLS]: normalizeHomeFoldDefault(parsed?.[HOME_FOLD_SECTION.CALLS] ?? legacy),
      [HOME_FOLD_SECTION.BRIEFING]: normalizeHomeFoldDefault(parsed?.[HOME_FOLD_SECTION.BRIEFING] ?? legacy),
    };
  } catch {
    return {
      [HOME_FOLD_SECTION.CALLS]: legacy,
      [HOME_FOLD_SECTION.BRIEFING]: legacy,
    };
  }
}

export function loadHomeFoldDefault(sectionId, storage = globalThis.localStorage) {
  const defaults = loadHomeFoldDefaults(storage);
  return defaults[sectionId] ?? HOME_FOLD_DEFAULT.COLLAPSED;
}

export function saveHomeFoldDefault(sectionId, value, storage = globalThis.localStorage) {
  const defaults = loadHomeFoldDefaults(storage);
  const normalized = normalizeHomeFoldDefault(value);
  const next = { ...defaults, [sectionId]: normalized };
  try {
    storage?.setItem(HOME_FOLD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // UI 편의 설정 저장 실패는 앱 핵심 기능을 막지 않는다.
  }
  return normalized;
}
