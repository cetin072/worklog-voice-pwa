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

test("기본 자동 범위는 숫자 150개가 아니라 최근 달력 3일이다", async () => {
  const source = await readFile(shortcutPath, "utf8");
  assert.equal(source.includes("const DEFAULT_RECENT_DAYS = 3"), true);
  assert.equal(source.includes("최근 ${DEFAULT_RECENT_DAYS}일"), true);
  assert.equal(source.includes("MAX_FOLDER_FILES"), false);
  assert.equal(source.includes("최근 오디오 최대"), false);
});

test("과거 통화는 시작일·종료일을 선택해 불러오는 UI가 있다", async () => {
  const source = await readFile(shortcutPath, "utf8");
  const css = await readFile(cssPath, "utf8");
  assert.equal(source.includes("이전 통화 기간 선택"), true);
  assert.equal(source.includes("선택 기간 불러오기"), true);
  assert.equal(source.includes("dateInputRange"), true);
  assert.match(css, /\.call-folder-range\[hidden\]\{display:none!important\}/);
});

test("폴더 목록 확인은 무한 대기하지 않도록 최대 20초 제한이다", async () => {
  assert.ok(DEFAULT_SCAN_TIMEOUT_MS > 0 && DEFAULT_SCAN_TIMEOUT_MS <= 20000);
  const source = await readFile(runtimePath, "utf8");
  assert.equal(source.includes("FOLDER_SCAN_TIMEOUT"), true);
});

test("숨김 UI는 CSS가 다시 노출시키지 않는다", async () => {
  const css = await readFile(cssPath, "utf8");
  assert.match(css, /\.call-folder-actions\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.call-folder-connection\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.call-folder-range\[hidden\]\{display:none!important\}/);
});

test("폴더 자동읽기 실패는 원인을 숨기지 않고 파일 선택 모드로 전환한다", async () => {
  const source = await readFile(shortcutPath, "utf8");
  assert.equal(source.includes("폴더 자동읽기에서는 내부 파일이 노출되지 않습니다"), true);
  assert.equal(source.includes("파일 선택 모드로 전환했습니다"), true);
  assert.equal(source.includes("FOLDER_SCAN_TIMEOUT"), true);
  assert.equal(source.includes("DIRECTORY_ITERATOR_UNSUPPORTED"), true);
  assert.equal(source.includes("날짜 확인 불가"), true);
});
