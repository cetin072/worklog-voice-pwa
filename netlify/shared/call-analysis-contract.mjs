export const CALL_ANALYSIS_CONTRACT_VERSION = "v1";

export const CALL_ANALYSIS_ACTION_TYPES = Object.freeze([
  "task",
  "schedule",
  "follow_up",
  "decision",
]);

// 공급자별 Structured Output/JSON Schema 기능에 맞게 변환해 쓸 수 있는
// 업무수첩 내부 표준 스키마. 이 객체 자체는 외부 API를 호출하지 않는다.
export const CALL_ANALYSIS_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    keyPoints: {
      type: "array",
      maxItems: 20,
      items: { type: "string" },
    },
    actions: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: CALL_ANALYSIS_ACTION_TYPES },
          content: { type: "string" },
          dueText: { type: "string" },
          dueStart: { type: "string" },
          dueHasTime: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sourceExcerpt: { type: "string" },
        },
        required: ["type", "content"],
      },
    },
    contacts: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          role: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
  required: ["summary", "keyPoints", "actions", "contacts"],
});

export function buildCallAnalysisInstruction(context = {}) {
  const contact = String(context.contactName || "").trim();
  const occurredAt = String(context.occurredAt || "").trim();
  return [
    "한국어 통화/회의 녹취록을 업무수첩용 구조화 데이터로 분석한다.",
    "사실을 만들지 말고 녹취록에서 확인되는 내용만 사용한다.",
    "상대방의 할 일과 사용자의 할 일을 구분하고, 불확실하면 confidence를 낮춘다.",
    "일정은 녹취록에 실제로 언급된 표현을 dueText에 보존한다.",
    "dueStart를 제시할 때는 날짜만 있으면 YYYY-MM-DD, 시간이 있으면 ISO 8601(+09:00)로 쓴다.",
    "일정/할 일은 자동 확정하지 않는다. confirmed 필드는 출력하지 않는다.",
    "sourceExcerpt에는 판단 근거가 되는 짧은 원문 부분만 넣는다.",
    contact ? `통화 상대 후보: ${contact}` : "",
    occurredAt ? `통화 기준시각: ${occurredAt}` : "",
  ].filter(Boolean).join("\n");
}
