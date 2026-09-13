import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shortcutPath = new URL("../public/call-folder-shortcut.mjs", import.meta.url);
const cssPath = new URL("../public/home-folds.css", import.meta.url);

test("폴더 스캔 단계에서는 getFile로 모든 파일을 열지 않는다", async () => {
  const source = await readFile(shortcutPath, "utf8");
  const start = source.indexOf("async function scanFolderEntries");
  const end = source.indexOf("async function materializeFiles", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const scanSource = source.slice(start, end);
  assert.equal(scanSource.includes("getFile("), false);
  assert.equal(scanSource.includes("rankAudioFileHandles"), true);
});

test("폴더 목록 확인은 무한 대기하지 않도록 제한시간이 있다", async () => {
  const source = await readFile(shortcutPath, "utf8");
  const match = source.match(/const FOLDER_SCAN_TIMEOUT_MS = (\d+);/);
  assert.ok(match);
  const timeoutMs = Number(match[1]);
  assert.ok(timeoutMs > 0 && timeoutMs <= 20000);
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
});
