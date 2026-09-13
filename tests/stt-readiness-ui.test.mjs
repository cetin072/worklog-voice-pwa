import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const uiUrl = new URL("../public/settings-ux.mjs", import.meta.url);

async function source() {
  return readFile(uiUrl, "utf8");
}

test("설정 AI·비용 카테고리에 STT 연결 준비상태를 표시한다", async () => {
  const text = await source();
  assert.equal(text.includes("STT 연결 준비상태"), true);
  assert.equal(text.includes("settingsSttReadinessSummary"), true);
  assert.equal(text.includes("settingsSttReadinessList"), true);
  assert.equal(text.includes("/api/call-processing-status"), true);
});

test("준비상태 조회 실패 시에도 실제 STT 잠금을 기본값으로 유지한다", async () => {
  const text = await source();
  assert.equal(text.includes("준비상태 조회 실패 · 실제 STT 연결은 계속 잠금"), true);
  assert.equal(text.includes("개발자 2인 합의 전에는 실제 유료 STT를 활성화하지 않습니다"), true);
});
