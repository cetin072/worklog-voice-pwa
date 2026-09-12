import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMockCallAnalysis,
  buildMockReviewPayload,
  mockReviewStats,
  normalizeMockSelectionItem,
} from "../public/mock-call-review-state.mjs";

test("선택 메타데이터를 정규화하고 파일 원본은 포함하지 않는다", () => {
  const item = normalizeMockSelectionItem({
    id: "call-1",
    contactName: "이선영이사",
    phone: "010-9665-5373",
    recordedAt: "2026-09-13T13:29:00+09:00",
    durationSeconds: 68,
    file: { secret: true },
  });
  assert.equal(item.contactName, "이선영이사");
  assert.equal(item.durationSeconds, 68);
  assert.equal("file" in item, false);
});

test("모의 분석은 실제 분석이 아님을 표시한다", () => {
  const result = buildMockCallAnalysis({
    id: "call-1",
    contactName: "이선영이사",
    recordedAt: "2026-09-13T13:29:00+09:00",
  });
  assert.equal(result.mock, true);
  assert.match(result.transcript, /모의 녹취/);
  assert.equal(result.actions.find((item) => item.type === "schedule").confirmed, false);
});

test("사용자가 제외한 액션은 모의 저장 payload에서 빠진다", () => {
  const result = buildMockCallAnalysis({ id: "1", contactName: "고객" });
  result.actions.find((item) => item.type === "decision").included = false;
  const payload = buildMockReviewPayload(result);
  assert.equal(payload.actions.some((item) => item.type === "decision"), false);
});

test("일정은 사용자 확정 전까지 confirmed=false다", () => {
  const result = buildMockCallAnalysis({ id: "1", contactName: "고객" });
  const schedule = result.actions.find((item) => item.type === "schedule");
  schedule.confirmed = false;
  const payload = buildMockReviewPayload(result);
  assert.equal(payload.actions.find((item) => item.type === "schedule").confirmed, false);
});

test("사용자가 일정 확정 체크하면 confirmed=true로 저장 후보가 된다", () => {
  const result = buildMockCallAnalysis({ id: "1", contactName: "고객" });
  const schedule = result.actions.find((item) => item.type === "schedule");
  schedule.confirmed = true;
  schedule.dueDate = "2026-09-17";
  schedule.dueTime = "15:00";
  const payload = buildMockReviewPayload(result);
  assert.equal(payload.actions.find((item) => item.type === "schedule").confirmed, true);
});

test("잘못된 일정 날짜 형식은 확정 상태를 해제한다", () => {
  const result = buildMockCallAnalysis({ id: "1", contactName: "고객" });
  const schedule = result.actions.find((item) => item.type === "schedule");
  schedule.confirmed = true;
  schedule.dueDate = "9/17";
  const payload = buildMockReviewPayload(result);
  const saved = payload.actions.find((item) => item.type === "schedule");
  assert.equal(saved.dueDate, "");
  assert.equal(saved.confirmed, false);
});

test("모의 저장 통계를 액션 종류별로 계산한다", () => {
  const result = buildMockCallAnalysis({ id: "1", contactName: "고객" });
  result.actions.find((item) => item.type === "schedule").confirmed = true;
  const stats = mockReviewStats(buildMockReviewPayload(result));
  assert.deepEqual(stats, {
    tasks: 1,
    schedules: 1,
    confirmedSchedules: 1,
    followUps: 1,
    decisions: 1,
    contacts: 1,
  });
});
