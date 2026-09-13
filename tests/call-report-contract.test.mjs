import test from "node:test";
import assert from "node:assert/strict";
import {
  CALL_ANALYSIS_CONTRACT_VERSION,
  CALL_ANALYSIS_JSON_SCHEMA,
  buildCallAnalysisInstruction,
} from "../netlify/shared/call-analysis-contract.mjs";
import { normalizeCallAnalysisResult } from "../netlify/shared/call-analysis-normalize.mjs";
import { normalizeAiAdapterResult } from "../netlify/shared/provider-adapter-contract.mjs";

const RECORDED_AT = new Date("2026-09-13T10:00:00+09:00");

test("분석 계약 V2는 통화 보고서를 필수 결과로 정의한다", () => {
  assert.equal(CALL_ANALYSIS_CONTRACT_VERSION, "v2");
  assert.equal(CALL_ANALYSIS_JSON_SCHEMA.required.includes("report"), true);
  assert.deepEqual(CALL_ANALYSIS_JSON_SCHEMA.properties.report.required, [
    "headline",
    "overview",
    "discussionPoints",
    "counterpartRequests",
    "userCommitments",
    "decisions",
    "openQuestions",
  ]);
});

test("분석 지시문은 보고서와 업무항목을 같은 분석에서 만들도록 고정한다", () => {
  const instruction = buildCallAnalysisInstruction({ contactName: "고객", occurredAt: RECORDED_AT.toISOString() });
  assert.match(instruction, /한 번에 분석/);
  assert.match(instruction, /보고서와 할 일·일정·후속조치·결정사항을 함께/);
  assert.match(instruction, /상대방 요청사항/);
  assert.match(instruction, /사용자가 약속한 사항/);
});

test("명시적 통화 보고서 섹션을 정규화한다", () => {
  const result = normalizeCallAnalysisResult({
    title: "고객 통화",
    summary: "요약",
    report: {
      headline: "한 줄 요약",
      overview: "전체 개요",
      discussionPoints: ["보험료 논의"],
      counterpartRequests: ["견적 전달 요청"],
      userCommitments: ["오늘 중 회신"],
      decisions: ["금요일 재통화"],
      openQuestions: ["특약 확인 필요"],
    },
    actions: [],
    contacts: [],
  }, { recordedAt: RECORDED_AT });

  assert.equal(result.analysisVersion, "v2");
  assert.equal(result.report.headline, "한 줄 요약");
  assert.deepEqual(result.report.counterpartRequests, ["견적 전달 요청"]);
  assert.deepEqual(result.report.openQuestions, ["특약 확인 필요"]);
});

test("구형 분석 결과도 보고서 기본값으로 안전하게 승격한다", () => {
  const result = normalizeCallAnalysisResult({
    title: "고객 통화",
    summary: "계약 조건을 논의했다.",
    keyPoints: ["보험료 확인"],
    actions: [{ type: "decision", content: "금요일 다시 연락" }],
  }, { recordedAt: RECORDED_AT });

  assert.equal(result.report.headline, "고객 통화");
  assert.equal(result.report.overview, "계약 조건을 논의했다.");
  assert.deepEqual(result.report.discussionPoints, ["보험료 확인"]);
  assert.deepEqual(result.report.decisions, ["금요일 다시 연락"]);
});

test("AI 응답이 보고서 중심이어도 내부 표준 결과로 수용한다", () => {
  const result = normalizeAiAdapterResult({
    analysis: {
      report: {
        headline: "고객 요청 확인",
        overview: "서류와 일정을 논의했다.",
        discussionPoints: ["서류 제출"],
        counterpartRequests: [],
        userCommitments: [],
        decisions: [],
        openQuestions: [],
      },
      summary: "",
      keyPoints: [],
      actions: [],
      contacts: [],
    },
  }, { recordedAt: RECORDED_AT });

  assert.equal(result.analysis.report.headline, "고객 요청 확인");
});
