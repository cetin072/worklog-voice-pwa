import { monthKey } from "./usage-meter.mjs";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function costOf(event) {
  return number(event?.estimatedCostKrw);
}

function serviceOf(event) {
  return String(event?.service || event?.category || "unknown").trim() || "unknown";
}

function featureOf(event) {
  return String(event?.feature || "unknown").trim() || "unknown";
}

function userOf(event) {
  return String(event?.userLabel || "").trim() || "사용자 미지정";
}

function groupBy(events, selector) {
  const map = new Map();
  for (const event of events) {
    const key = selector(event);
    if (!map.has(key)) {
      map.set(key, {
        key,
        events: 0,
        estimatedCostKrw: 0,
        actualCostKrw: 0,
        actualCostEvents: 0,
        audioSeconds: 0,
        apiCalls: 0,
        failed: 0,
      });
    }
    const item = map.get(key);
    item.events += 1;
    item.estimatedCostKrw += costOf(event);
    item.apiCalls += number(event?.apiCalls || 1);
    if (serviceOf(event) === "stt") {
      item.audioSeconds += number(event?.audioSeconds ?? event?.durationSeconds);
    }
    if (event?.status === "failed") item.failed += 1;
    const actual = event?.actualCostKrw;
    if (actual !== null && actual !== undefined && actual !== "" && Number.isFinite(Number(actual)) && Number(actual) >= 0) {
      item.actualCostKrw += Number(actual);
      item.actualCostEvents += 1;
    }
  }
  return [...map.values()].sort((a, b) => {
    if (b.estimatedCostKrw !== a.estimatedCostKrw) return b.estimatedCostKrw - a.estimatedCostKrw;
    return a.key.localeCompare(b.key, "ko-KR");
  });
}

function workUnitKey(event) {
  const type = String(event?.relatedType || "").trim();
  if (!type) return "";
  const id = String(event?.relatedId || event?.requestId || "").trim();
  return id ? `${type}:${id}` : "";
}

function summarizeWorkUnits(events) {
  const units = new Map();
  for (const event of events) {
    const key = workUnitKey(event);
    if (!key) continue;
    const [type] = key.split(":", 1);
    if (!units.has(key)) units.set(key, { type, estimatedCostKrw: 0, audioSeconds: 0 });
    const unit = units.get(key);
    unit.estimatedCostKrw += costOf(event);
    if (serviceOf(event) === "stt") {
      unit.audioSeconds = Math.max(unit.audioSeconds, number(event?.audioSeconds ?? event?.durationSeconds));
    }
  }

  const byType = new Map();
  for (const unit of units.values()) {
    if (!byType.has(unit.type)) byType.set(unit.type, { type: unit.type, count: 0, estimatedCostKrw: 0, audioSeconds: 0 });
    const group = byType.get(unit.type);
    group.count += 1;
    group.estimatedCostKrw += unit.estimatedCostKrw;
    group.audioSeconds += unit.audioSeconds;
  }

  return [...byType.values()].map((item) => ({
    ...item,
    averageCostKrw: item.count ? item.estimatedCostKrw / item.count : 0,
    averageAudioSeconds: item.count ? item.audioSeconds / item.count : 0,
  })).sort((a, b) => b.estimatedCostKrw - a.estimatedCostKrw);
}

export function summarizeUsageDashboard(events = [], now = new Date()) {
  const targetMonth = monthKey(now);
  const monthEvents = (Array.isArray(events) ? events : []).filter((event) => monthKey(event?.createdAt) === targetMonth);
  const total = monthEvents.reduce((summary, event) => {
    summary.events += 1;
    summary.estimatedCostKrw += costOf(event);
    summary.apiCalls += number(event?.apiCalls || 1);
    if (serviceOf(event) === "stt") {
      summary.sttCalls += 1;
      summary.audioSeconds += number(event?.audioSeconds ?? event?.durationSeconds);
    }
    if (serviceOf(event) === "ai") summary.aiCalls += 1;
    if (event?.status === "failed") summary.failed += 1;
    const actual = event?.actualCostKrw;
    if (actual !== null && actual !== undefined && actual !== "" && Number.isFinite(Number(actual)) && Number(actual) >= 0) {
      summary.actualCostKrw += Number(actual);
      summary.actualCostEvents += 1;
    }
    return summary;
  }, {
    month: targetMonth,
    events: 0,
    estimatedCostKrw: 0,
    actualCostKrw: 0,
    actualCostEvents: 0,
    apiCalls: 0,
    sttCalls: 0,
    aiCalls: 0,
    audioSeconds: 0,
    failed: 0,
  });

  return {
    month: targetMonth,
    total,
    byUser: groupBy(monthEvents, userOf),
    byService: groupBy(monthEvents, serviceOf),
    byFeature: groupBy(monthEvents, featureOf),
    workUnits: summarizeWorkUnits(monthEvents),
  };
}

export function serviceLabel(value) {
  return ({
    stt: "음성변환 STT",
    ai: "AI 분석",
    storage: "임시 저장소",
    database: "DB",
    ocr: "OCR",
    api: "기타 API",
    unknown: "미분류",
  })[value] || value;
}

export function featureLabel(value) {
  return ({
    call_transcription: "통화 음성변환",
    call_summary: "통화 요약",
    call_processing: "통화 처리",
    call_persist: "통화 결과 저장",
    meeting_transcription: "회의 음성변환",
    meeting_summary: "회의 요약",
    briefing_ai: "브리핑 AI",
    image_ocr: "문서 OCR",
    unknown: "미분류",
  })[value] || value;
}
