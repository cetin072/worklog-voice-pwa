import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const uiUrl = new URL("../public/mock-call-review.mjs", import.meta.url);

async function source() {
  return readFile(uiUrl, "utf8");
}

test("모의 검수 화면은 통화 보고서를 최종 결과 중심으로 표시한다", async () => {
  const text = await source();
  assert.equal(text.includes('heading.textContent = "통화 보고서"'), true);
  for (const label of [
    "한 줄 요약",
    "통화 개요",
    "주요 논의사항 · 한 줄에 하나",
    "상대방 요청사항",
    "내가 약속한 사항",
    "결정사항",
    "확인 필요사항",
    "전체 녹취록 보기",
  ]) {
    assert.equal(text.includes(label), true, `${label} UI가 있어야 한다`);
  }
});

test("보고서와 실행항목은 같은 모의 분석 흐름 안에서 검수한다", async () => {
  const text = await source();
  assert.equal(text.includes("통화 보고서·업무항목 모의 분석 생성"), true);
  assert.equal(text.includes("업무로 옮길 항목"), true);
  assert.equal(text.includes("보고서는 기록용 결과이고"), true);
});

test("모의 저장은 보고서 V2 세션키를 사용하고 실제 외부 저장을 하지 않는다고 표시한다", async () => {
  const text = await source();
  assert.equal(text.includes("worklog.mockCallReview.results.v2"), true);
  assert.equal(text.includes("실제 DB·STT·AI에는 전송하지 않았습니다"), true);
});
