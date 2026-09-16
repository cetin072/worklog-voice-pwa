import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function runMainUiState(seed = {}) {
  const store = new Map(Object.entries(seed));
  const events = [];
  const localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  class CustomEventMock {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const window = { dispatchEvent: (event) => events.push(event) };
  window.window = window;
  const context = { window, localStorage, CustomEvent: CustomEventMock, Object, JSON };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/main-ui-state.js", "utf8"), context);
  return { window, store, events };
}

test("main ui state clears legacy hidden draft extras without losing the draft text", () => {
  const draft = {
    text: "계약서 확인",
    institution: "기타",
    status: "진행중",
    type: "할 일",
    amount: "150000",
    assignee: "홍길동",
    dueDate: "2026-09-17",
    followUp: "전화",
  };
  const { store } = runMainUiState({ worklogDraftV1: JSON.stringify(draft) });
  const saved = JSON.parse(store.get("worklogDraftV1"));
  assert.equal(saved.text, "계약서 확인");
  assert.equal(saved.amount, "");
  assert.equal(saved.assignee, "");
  assert.equal(saved.dueDate, "");
  assert.equal(saved.followUp, "");
});

test("main ui state preserves the briefing preference read/save contract", () => {
  const { window, store, events } = runMainUiState({
    worklogUiPreferencesV1: JSON.stringify({ briefingCollapsed: true }),
  });
  assert.equal(window.WorklogUiPreferences.read().briefingCollapsed, true);
  const saved = window.WorklogUiPreferences.save({ briefingCollapsed: false });
  assert.equal(saved.briefingCollapsed, false);
  assert.equal(JSON.parse(store.get("worklogUiPreferencesV1")).briefingCollapsed, false);
  assert.equal(events.at(-1)?.type, "worklog:ui-preferences-changed");
  assert.equal(events.at(-1)?.detail?.briefingCollapsed, false);
});

test("main loads current ui state while settings keeps the full settings bundle", () => {
  const main = fs.readFileSync("public/index.html", "utf8");
  const settings = fs.readFileSync("public/settings.html", "utf8");
  const sw = fs.readFileSync("public/sw.js", "utf8");
  const state = fs.readFileSync("public/main-ui-state.js", "utf8");
  assert.doesNotMatch(main, /\/settings\.js\?v=/);
  assert.match(main, /\/main-ui-state\.js\?v=20260916-4/);
  assert.match(settings, /\/settings\.js\?v=/);
  assert.match(sw, /"\/main-ui-state\.js"/);
  assert.match(state, /\/search\.js\?v=20260916-5/);
});

test("successful worklog saves emit one briefing refresh signal at the common fetch boundary", () => {
  const source = fs.readFileSync("public/main-ui-state.js", "utf8");
  assert.match(source, /details\.url\.pathname === "\/api\/worklog"/);
  assert.match(source, /new CustomEvent\("worklog:record-saved"/);
  assert.match(source, /window\.setTimeout\(\(\) => triggerBriefingRefresh\(\), 120\)/);
  assert.match(source, /window\.clearTimeout\(briefingRefreshTimer\)/);
});

test("Data Core refresh reuses V2 renderer without calling legacy quick-update mutation", () => {
  const source = fs.readFileSync("public/main-ui-state.js", "utf8");
  assert.match(source, /details\.url\.pathname === "\/api\/briefing"/);
  assert.match(source, /platformSession\(\)\?\.access_token/);
  assert.match(source, /quickUpdateAction\(init\)/);
  assert.match(source, /mode: "data_core_refresh"/);
  assert.match(source, /quick\.click\(\)/);
});

test("briefing reset clears per-user SWR caches and exposes an explicit reset button", () => {
  const source = fs.readFileSync("public/main-ui-state.js", "utf8");
  assert.match(source, /worklogBriefingV2SnapshotV1:/);
  assert.match(source, /worklogBriefingV2DataV1:/);
  assert.match(source, /button\.id = "briefingReset"/);
  assert.match(source, /↻ 브리핑 리셋/);
  assert.match(source, /clearBriefingCache\(\)/);
  assert.match(source, /new CustomEvent\("worklog:briefing-reset"\)/);
});
