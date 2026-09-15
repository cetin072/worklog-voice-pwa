export const CALL_ANALYSIS_CONTRACT_VERSION = "v2";

export const CALL_ANALYSIS_ACTION_TYPES = Object.freeze([
  "task",
  "schedule",
  "follow_up",
  "decision",
]);

export const CALL_REPORT_SECTION_KEYS = Object.freeze([
  "discussionPoints",
  "counterpartRequests",
  "userCommitments",
  "decisions",
  "openQuestions",
]);

export function buildCallAnalysisInstruction(context = {}) {
  const contact = String(context.contactName || "").trim();
  const occurredAt = String(context.occurredAt || "").trim();
  return [
    "한국어 통화 녹취록을 업무수첩용 구조화 데이터로 분석한다.",
    "같은 분석 결과에서 통화 보고서와 할 일·일정·후속조치·결정사항을 함께 만든다.",
    "사실을 만들지 말고 녹취록에서 확인되는 내용만 사용한다.",
    "report.headline은 한 줄 요약, report.overview는 통화 전체 개요로 작성한다.",
    "report.discussionPoints에는 주요 논의사항, counterpartRequests에는 상대방 요청사항, userCommitments에는 사용자가 약속한 사항만 넣는다.",
    "report.decisions에는 실제 합의·결정된 내용만, openQuestions에는 추가 확인이 필요한 사항만 넣는다.",
    "상대방의 할 일과 사용자의 할 일을 구분하고, 불확실하면 confidence를 낮춘다.",
    "일정은 실제 언급된 표현을 dueText에 보존한다.",
    "dueStart는 날짜만 있으면 YYYY-MM-DD, 시간이 있으면 ISO 8601(+09:00)로 쓴다.",
    "일정/할 일은 자동 확정하지 않는다. confirmed 필드는 출력하지 않는다.",
    "sourceExcerpt에는 판단 근거가 되는 짧은 원문 부분만 넣는다.",
    contact ? `통화 상대 후보: ${contact}` : "",
    occurredAt ? `통화 기준시각: ${occurredAt}` : "",
  ].filter(Boolean).join("\n");
}
