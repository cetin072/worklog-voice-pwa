import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_FOLD_DEFAULT,
  HOME_FOLD_SECTION,
  HOME_FOLD_STORAGE_KEY,
  LEGACY_HOME_FOLD_STORAGE_KEY,
  loadHomeFoldDefault,
  loadHomeFoldDefaults,
  saveHomeFoldDefault,
} from "../public/home-folds-state.mjs";

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
  };
}

test("처음에는 통화와 브리핑이 각각 기본 접기다", () => {
  const store = storage();
  const result = loadHomeFoldDefaults(store);
  assert.equal(result[HOME_FOLD_SECTION.CALLS], HOME_FOLD_DEFAULT.COLLAPSED);
  assert.equal(result[HOME_FOLD_SECTION.BRIEFING], HOME_FOLD_DEFAULT.COLLAPSED);
});

test("기존 전체 펼치기 설정은 항목별 초기값으로 이어받는다", () => {
  const store = storage({ [LEGACY_HOME_FOLD_STORAGE_KEY]: HOME_FOLD_DEFAULT.EXPANDED });
  const result = loadHomeFoldDefaults(store);
  assert.equal(result[HOME_FOLD_SECTION.CALLS], HOME_FOLD_DEFAULT.EXPANDED);
  assert.equal(result[HOME_FOLD_SECTION.BRIEFING], HOME_FOLD_DEFAULT.EXPANDED);
});

test("통화와 브리핑 기본 상태를 서로 다르게 저장할 수 있다", () => {
  const store = storage();
  saveHomeFoldDefault(HOME_FOLD_SECTION.CALLS, HOME_FOLD_DEFAULT.EXPANDED, store);
  saveHomeFoldDefault(HOME_FOLD_SECTION.BRIEFING, HOME_FOLD_DEFAULT.COLLAPSED, store);

  assert.equal(loadHomeFoldDefault(HOME_FOLD_SECTION.CALLS, store), HOME_FOLD_DEFAULT.EXPANDED);
  assert.equal(loadHomeFoldDefault(HOME_FOLD_SECTION.BRIEFING, store), HOME_FOLD_DEFAULT.COLLAPSED);

  const saved = JSON.parse(store.getItem(HOME_FOLD_STORAGE_KEY));
  assert.equal(saved.calls, HOME_FOLD_DEFAULT.EXPANDED);
  assert.equal(saved.briefing, HOME_FOLD_DEFAULT.COLLAPSED);
});
