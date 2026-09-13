import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_SCAN_TIMEOUT_MS } from "../public/call-folder-runtime.mjs";

const shortcutPath = new URL("../public/call-folder-shortcut.mjs", import.meta.url);
const runtimePath = new URL("../public/call-folder-runtime.mjs", import.meta.url);
const cssPath = new URL("../public/home-folds.css", import.meta.url);

test("실제 UI는 테스트 가능한 폴더 런타임 모듈을 사용한다", async () => {
  const source = await readFile(shortcutPath, "utf8");
  assert.equal(source.includes('from "./call-folder-runtime.mjs"'), true);
  assert.equal(source.includes("readFolderFiles(handle"), true);
});

test("폴더 목록 확인은 무한 대기하지 않도록 최대 20초 제한이다", async () => {
  assert.ok(DEFAULT_SCAN_TIMEOUT_MS > 0 && DEFAULT_SCAN_TIMEOUT_MS <= 20000);
  const source = await readFile(runtimePath, "utf8");
  assert.equal(source.includes("FOLDER_SCAN_TIMEOUT"), true);
});

test("연결 전 폴더 변경·연결 해제 버튼은 hidden을 CSS가 덮어쓰지 않는다", async () => {
  const css = await readFile(cssPath, "utf8");
  assert.match(css, /\.call-folder-actions\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.call-folder-connection\[hidden\]\{display:none!important\}/);
});

test("폴더 진단 문구는 오디오 0건과 브라우저 파일 열기 실패를 구분한다", async () => {
  const source = await readFile(shortcutPath, "utf8");
  assert.equal(source.includes("오디오 파일이 0건"), true);
  assert.equal(source.includes("Edge가 파일을 열지 못했습니다"), true);
  assert.equal(source.includes("목록 확인이 20초를 넘어 중단"), true);
  assert.equal(source.includes("폴더 내부 목록 읽기를 지원하지 않습니다"), true);
});
