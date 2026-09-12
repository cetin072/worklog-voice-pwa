import test from "node:test";
import assert from "node:assert/strict";
import {
  featureLabel,
  serviceLabel,
  summarizeUsageDashboard,
} from "../public/usage-dashboard-model.mjs";

const NOW = new Date("2026-09-13T12:00:00+09:00");

function event(input = {}) {
  return {
    createdAt: "2026-09-13T10:00:00+09:00",
    userLabel: "개발자 A",
    feature: "call_transcription",
    service: "stt",
    audioSeconds: 600,
    apiCalls: 1,
    estimatedCostKrw: 100,
    actualCostKrw: null,
    status: "success",
    relatedType: "call",
    requestId: "req-1",
    ...input,
  };
}

test("이번 달 이벤트만 합산한다", () => {
  const result = summarizeUsageDashboard([
    event(),
    event({ createdAt: "2026-08-31T12:00:00+09:00", estimatedCostKrw: 999 }),
  ], NOW);
  assert.equal(result.total.events, 1);
  assert.equal(result.total.estimatedCostKrw, 100);
});

test("두 개발자 사용량을 사용자별로 분리하고 전체에는 합산한다", () => {
  const result = summarizeUsageDashboard([
    event({ userLabel: "개발자 A", estimatedCostKrw: 100 }),
    event({ userLabel: "개발자 B", requestId: "req-2", estimatedCostKrw: 200 }),
  ], NOW);
  assert.equal(result.total.estimatedCostKrw, 300);
  assert.equal(result.byUser.length, 2);
  assert.equal(result.byUser.find((item) => item.key === "개발자 B").estimatedCostKrw, 200);
});

test("서비스별과 기능별 원가를 분리한다", () => {
  const result = summarizeUsageDashboard([
    event({ service: "stt", feature: "call_transcription", estimatedCostKrw: 100 }),
    event({ service: "ai", feature: "call_summary", audioSeconds: 0, estimatedCostKrw: 30 }),
  ], NOW);
  assert.equal(result.byService.find((item) => item.key === "stt").estimatedCostKrw, 100);
  assert.equal(result.byService.find((item) => item.key === "ai").estimatedCostKrw, 30);
  assert.equal(result.byFeature.find((item) => item.key === "call_summary").estimatedCostKrw, 30);
});

test("같은 통화의 STT와 AI 비용을 한 업무 단위로 합쳐 건당 평균원가를 계산한다", () => {
  const result = summarizeUsageDashboard([
    event({ requestId: "req-1", service: "stt", estimatedCostKrw: 100 }),
    event({ requestId: "req-1", service: "ai", feature: "call_summary", audioSeconds: 0, estimatedCostKrw: 20 }),
    event({ requestId: "req-2", service: "stt", estimatedCostKrw: 80, audioSeconds: 300 }),
  ], NOW);
  const calls = result.workUnits.find((item) => item.type === "call");
  assert.equal(calls.count, 2);
  assert.equal(calls.estimatedCostKrw, 200);
  assert.equal(calls.averageCostKrw, 100);
  assert.equal(calls.audioSeconds, 900);
});

test("STT 시간은 AI 이벤트에서 중복 합산하지 않는다", () => {
  const result = summarizeUsageDashboard([
    event({ service: "stt", audioSeconds: 600 }),
    event({ service: "ai", feature: "call_summary", audioSeconds: 600, estimatedCostKrw: 20 }),
  ], NOW);
  assert.equal(result.total.audioSeconds, 600);
});

test("실패 건수와 실제비용 확인 건수를 집계한다", () => {
  const result = summarizeUsageDashboard([
    event({ status: "failed", actualCostKrw: 110 }),
    event({ requestId: "req-2", actualCostKrw: null }),
  ], NOW);
  assert.equal(result.total.failed, 1);
  assert.equal(result.total.actualCostEvents, 1);
  assert.equal(result.total.actualCostKrw, 110);
});

test("서비스와 기능 라벨을 사용자용 이름으로 바꾼다", () => {
  assert.equal(serviceLabel("stt"), "음성변환 STT");
  assert.equal(featureLabel("call_summary"), "통화 요약");
});
