import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("App Shell에 통화폴더 대표 흐름의 필수 DOM과 모듈이 모두 연결돼 있다", async () => {
  const html = await text("../public/index.html");
  for (const id of ["callImport", "callFiles", "callInboxList", "callInboxStatus", "settingsCard", "settingsOpen", "settingsClose"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const src of ["/home-folds.mjs", "/call-inbox.mjs", "/call-folder-shortcut.mjs"]) {
    assert.equal(html.includes(`src=\"${src}\"`), true, `${src}가 index.html에 연결돼 있어야 한다`);
  }
  assert.equal(html.includes("최근 3일 통화를 기본으로 불러옵니다"), true);
  assert.equal(html.includes("파일 직접 선택"), true);
});

test("폴더·파일선택 결과는 앱 내부 이벤트로 통화함에 직접 전달되고 file input fallback도 유지한다", async () => {
  const shortcut = await text("../public/call-folder-shortcut.mjs");
  const inbox = await text("../public/call-inbox.mjs");
  assert.equal(shortcut.includes("worklog:call-files-import"), true);
  assert.equal(inbox.includes('window.addEventListener("worklog:call-files-import"'), true);
  assert.equal(inbox.includes("event.detail.accepted = true"), true);
  assert.equal(shortcut.includes("fileInput.dispatchEvent(new Event(\"change\", { bubbles: true }))"), true);
  assert.equal(inbox.includes("fileInput?.addEventListener(\"change\""), true);
});

test("Edge Android에서는 폴더 자동읽기보다 위치 기억형 다중 파일선택을 우선한다", async () => {
  const shortcut = await text("../public/call-folder-shortcut.mjs");
  assert.match(shortcut, /EdgA\\\//);
  assert.equal(shortcut.includes("showOpenFilePicker"), true);
  assert.equal(shortcut.includes('id: FILE_PICKER_ID'), true);
  assert.equal(shortcut.includes("multiple: true"), true);
  assert.equal(shortcut.includes("options.startIn = currentHandle"), true);
  assert.equal(shortcut.includes("selectAudioFilesInRange"), true);
});

test("폴더 timeout·iterator 실패는 같은 기기에서 파일선택 모드로 학습한다", async () => {
  const shortcut = await text("../public/call-folder-shortcut.mjs");
  assert.equal(shortcut.includes("DIRECTORY_BLOCKED_KEY"), true);
  assert.equal(shortcut.includes('["FOLDER_SCAN_TIMEOUT", "DIRECTORY_ITERATOR_UNSUPPORTED"]'), true);
  assert.equal(shortcut.includes("setDirectoryReadBlocked(true)"), true);
});

test("동적 UX 보강 모듈 파일이 저장소에 존재하고 로딩 실패가 핵심 통화 가져오기를 막지 않는다", async () => {
  const folds = await text("../public/home-folds.mjs");
  await Promise.all([
    text("../public/call-folder-guide.mjs"),
    text("../public/settings-ux.mjs"),
    text("../public/ux-refinement.css"),
  ]);
  assert.equal(folds.includes('import("./call-folder-guide.mjs").catch(() => {})'), true);
  assert.equal(folds.includes('import("./settings-ux.mjs").catch(() => {})'), true);
});
