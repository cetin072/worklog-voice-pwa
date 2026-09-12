import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCallAnalysisResult,
  splitCallAnalysisActions,
} from "../netlify/shared/call-analysis-normalize.mjs";

const RECORDED_AT = new Date("2026-09-13T10:00:00+09:00");

test("AI가 confirmed=true를 보내도 사용자 확인 전에는 false로 고정한다", () => {
  const result = normalizeCallAnalysisResult({
    actions: [{ type: "task", content: "계약서 확인", confirmed: true }],
  }, { recordedAt: RECORDED_AT });
  assert.equal(result.actions[0].confirmed, false);
});

test("자연어 일정 후보를 기존 일정 파서로 검증한다", () => {
  const result = normalizeCallAnalysisResult({
    actions: [{ type: "schedule", content: "고객 미팅", dueText: "내일 오후 3시", confidence: 0.9 }],
  }, { recordedAt: RECORDED_AT });
  const schedule = result.actions[0];
  assert.equal(schedule.dueStart, "2026-09-14T15:00:00+09:00");
  assert.equal(schedule.dueHasTime, true);
  assert.equal(schedule.needsReview, false);
});

test("모호한 일정 표현은 자동 확정 날짜를 만들지 않는다", () => {
  const result = normalizeCallAnalysisResult({
    actions: [{ type: "schedule", content: "고객 미팅", dueText: "내일 또는 모레 오후 3시" }],
  }, { recordedAt: RECORDED_AT });
  const schedule = result.actions[0];
  assert.equal(schedule.dueStart, "");
  assert.equal(schedule.dueHasTime, false);
  assert.equal(schedule.needsReview, true);
});

test("날짜만 있는 일정은 자정으로 바꾸지 않고 날짜-only로 보존한다", () => {
  const result = normalizeCallAnalysisResult({
    actions: [{ type: "schedule", content: "서류 제출", dueText: "9월 17일" }],
  }, { recordedAt: RECORDED_AT });
  const schedule = result.actions[0];
  assert.equal(schedule.dueStart, "2026-09-17");
  assert.equal(schedule.dueHasTime, false);
  assert.equal(schedule.needsReview, false);
});

test("일정 표현이 content 안에 있으면 일정 문구를 제거한 내용도 보존한다", () => {
  const result = normalizeCallAnalysisResult({
    actions: [{ type: "schedule", content: "내일 오후 3시 고객 미팅" }],
  }, { recordedAt: RECORDED_AT });
  const schedule = result.actions[0];
  assert.equal(schedule.dueStart, "2026-09-14T15:00:00+09:00");
  assert.equal(schedule.content, "고객 미팅");
});

test("핵심내용 중복과 지원하지 않는 액션 유형을 제거한다", () => {
  const result = normalizeCallAnalysisResult({
    keyPoints: ["보험료 확인", "보험료 확인", " 서류 제출 "],
    actions: [
      { type: "task", content: "보험료 확인" },
      { type: "unknown", content: "무시" },
    ],
  }, { recordedAt: RECORDED_AT });
  assert.deepEqual(result.keyPoints, ["보험료 확인", "서류 제출"]);
  assert.equal(result.actions.length, 1);
});

test("명시적 dueStart도 날짜/시간 형식을 구분해 보존한다", () => {
  const result = normalizeCallAnalysisResult({
    actions: [
      { type: "schedule", content: "서류 제출", dueStart: "2026-09-17", dueHasTime: false },
      { type: "schedule", content: "미팅", dueStart: "2026-09-18T14:30:00+09:00", dueHasTime: true },
    ],
  }, { recordedAt: RECORDED_AT });
  assert.equal(result.actions[0].dueStart, "2026-09-17");
  assert.equal(result.actions[0].dueHasTime, false);
  assert.equal(result.actions[1].dueStart, "2026-09-18T14:30:00+09:00");
  assert.equal(result.actions[1].dueHasTime, true);
});

test("액션을 할일/일정/후속조치/결정사항으로 나눈다", () => {
  const result = normalizeCallAnalysisResult({
    actions: [
      { type: "task", content: "A" },
      { type: "schedule", content: "B", dueText: "내일" },
      { type: "follow_up", content: "C" },
      { type: "decision", content: "D" },
    ],
  }, { recordedAt: RECORDED_AT });
  const split = splitCallAnalysisActions(result);
  assert.equal(split.tasks.length, 1);
  assert.equal(split.schedules.length, 1);
  assert.equal(split.followUps.length, 1);
  assert.equal(split.decisions.length, 1);
});
