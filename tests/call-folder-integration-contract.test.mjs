import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("App Shell에 통화녹음 직접 선택 대표 흐름의 필수 DOM과 모듈이 모두 연결돼 있다", async () => {
  const html = await text("../public/index.html");
  for (const id of ["callImport", "callFiles", "callInboxList", "callInboxStatus", "settingsCard", "settingsOpen", "settingsClose"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const src of ["/home-folds.mjs", "/call-inbox.mjs", "/call-folder-shortcut.mjs"]) {
    assert.equal(html.includes(`src=\"${src}\"`), true, `${src}가 index.html에 연결돼 있어야 한다`);
  }
  assert.equal(html.includes("통화녹음 파일 선택"), true);
  assert.equal(html.includes('accept="audio/*,.m4a,.mp3,.wav,.aac,.3gp,.mp4,.ogg,.opus"'), true);
  assert.equal(html.includes("Edge Android에서는 검증된 파일 선택 방식을 기본으로 사용합니다"), true);
});

test("직접 파일선택 결과는 기존 통화함 import 경로로 전달된다", async () => {
  const inbox = await text("../public/call-inbox.mjs");
  assert.equal(inbox.includes('importButton?.addEventListener("click", () => fileInput?.click())'), true);
  assert.equal(inbox.includes('fileInput?.addEventListener("change"'), true);
  assert.equal(inbox.includes("importFiles(fileInput.files)"), true);
});

test("폴더·고급 파일선택 결과는 앱 내부 이벤트로 통화함에 직접 전달되고 file input fallback도 유지한다", async () => {
  const shortcut = await text("../public/call-folder-shortcut.mjs");
  const inbox = await text("../public/call-inbox.mjs");
  assert.equal(shortcut.includes("worklog:call-files-import"), true);
  assert.equal(inbox.includes('window.addEventListener("worklog:call-files-import"'), true);
  assert.equal(inbox.includes("event.detail.accepted = true"), true);
  assert.equal(shortcut.includes("fileInput.dispatchEvent(new Event(\"change\", { bubbles: true }))"), true);
});

test("Edge Android에서는 실패한 폴더 자동읽기 UI를 숨기고 직접 파일선택 버튼을 기본으로 노출한다", async () => {
  const guide = await text("../public/call-folder-guide.mjs");
  const css = await text("../public/home-folds.css");
  assert.match(guide, /EdgA\\\//);
  assert.equal(guide.includes("applyEdgeDirectSelectionUx"), true);
  assert.equal(guide.includes("shortcut.hidden = true"), true);
  assert.equal(guide.includes('importButton.textContent = "통화녹음 파일 선택"'), true);
  assert.equal(guide.includes("검증된 파일 선택 방식을 사용합니다"), true);
  assert.match(css, /\.call-folder-shortcut\[hidden\]\{display:none!important\}/);
});

test("Edge 직접 선택 모드는 모듈 로딩 순서가 달라도 MutationObserver로 최종 적용한다", async () => {
  const guide = await text("../public/call-folder-guide.mjs");
  assert.equal(guide.includes("watchEdgeDirectSelectionUx"), true);
  assert.equal(guide.includes("new MutationObserver"), true);
  assert.equal(guide.includes("observer.disconnect()"), true);
});

test("Edge 안내는 폴더 재연결을 유도하지 않고 오디오 파일 다중선택을 설명한다", async () => {
  const guide = await text("../public/call-folder-guide.mjs");
  assert.equal(guide.includes("파일 선택창에서 ‘오디오’를 누르고 필요한 통화녹음을 여러 개 고르세요"), true);
  assert.equal(guide.includes("위 경로는 찾을 때 참고용입니다"), true);
  assert.equal(guide.includes("홈으로 나갔다가 업무수첩으로 돌아오면"), false);
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
