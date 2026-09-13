import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("통화함이 선택 메타데이터를 DOM 재파싱 없이 직접 모의 분석으로 전달한다", async () => {
  const inbox = await text("../public/call-inbox.mjs");
  assert.equal(inbox.includes('from "./call-selection-event.mjs"'), true);
  assert.equal(inbox.includes('worklog:call-selection-ready'), true);
  assert.equal(inbox.includes('source: "call-inbox-selection"'), true);
  assert.equal(inbox.includes('summary.dataset.selectionPayloadReady = "true"'), true);
});

test("DOM 브리지는 직접 선택 payload가 있으면 fallback을 실행하지 않는다", async () => {
  const bridge = await text("../public/mock-call-review-bridge.mjs");
  assert.equal(bridge.includes('summary.dataset.selectionPayloadReady === "true"'), true);
  assert.equal(bridge.includes('source: "local-dom-metadata-fallback"'), true);
});

test("모의 검수 화면은 전체화면 dialog와 실제 통화 메타 표시를 제공한다", async () => {
  const review = await text("../public/mock-call-review.mjs");
  const css = await text("../public/mock-call-review.css");
  assert.equal(review.includes('role", "dialog"'), true);
  assert.equal(review.includes('aria-modal", "true"'), true);
  assert.equal(review.includes("renderSourceMeta(source)"), true);
  assert.equal(review.includes("formatRecordedAt(source.recordedAt)"), true);
  assert.equal(review.includes("formatDuration(source.durationSeconds)"), true);
  assert.match(css, /\.mock-review-card\{position:fixed!important/);
  assert.match(css, /\.mock-review-actions\{position:sticky/);
});

test("일정 후보는 사용자 확정 원칙을 화면에 명시한다", async () => {
  const review = await text("../public/mock-call-review.mjs");
  assert.equal(review.includes("직접 확정한 일정만 실제 일정 저장 대상으로 사용합니다"), true);
  assert.equal(review.includes("미확정 일정"), true);
});
