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

test("main loads minimal ui state while settings keeps the full settings bundle", () => {
  const main = fs.readFileSync("public/index.html", "utf8");
  const settings = fs.readFileSync("public/settings.html", "utf8");
  const sw = fs.readFileSync("public/sw.js", "utf8");
  assert.doesNotMatch(main, /\/settings\.js\?v=/);
  assert.match(main, /\/main-ui-state\.js\?v=20260916-1/);
  assert.match(settings, /\/settings\.js\?v=/);
  assert.match(sw, /"\/main-ui-state\.js"/);
});
