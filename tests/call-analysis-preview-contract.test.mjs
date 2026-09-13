import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const previewUrl = new URL("../public/call-analysis-preview.mjs", import.meta.url);

async function source() {
  return readFile(previewUrl, "utf8");
}

test("분석 준비 화면은 선택 이벤트의 안전 파일 메타데이터로 로컬 사전검사를 실행한다", async () => {
  const text = await source();
  assert.match(text, /validateCallSelectionPreflight/);
  assert.match(text, /worklog:call-selection-ready/);
  for (const field of ["fileName", "mimeType", "fileSize", "lastModified", "durationSeconds"]) {
    assert.equal(text.includes(field), true, `${field} 메타데이터를 사용해야 한다`);
  }
});

test("공급자 한도 미확정 상태에서는 유료 처리 준비완료로 오인하지 않는다", async () => {
  const text = await source();
  assert.equal(text.includes("providerLimitsConfirmed: false"), true);
  assert.equal(text.includes("공급자 한도 확인 전"), true);
  assert.equal(text.includes("실제 STT 연결 전에는 공급자 선택과 최신 파일 크기·길이·MIME 한도 확인"), true);
});

test("유료 STT·AI는 2인 승인 전 파일 전송 없이 잠겨 있음을 표시한다", async () => {
  const text = await source();
  assert.equal(text.includes("개발자 2인 승인 전까지 잠겨 있습니다"), true);
  assert.equal(text.includes("현재는 파일을 전송하지 않습니다"), true);
});
