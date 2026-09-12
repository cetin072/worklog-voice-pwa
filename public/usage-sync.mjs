import {
  createUsageEvent,
  loadUsageEvents,
  monthKey,
  recordUsageEvent,
} from "./usage-meter.mjs";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeImportedEvent(value) {
  if (!value || typeof value !== "object") return null;
  if (!value.id || !value.createdAt) return null;
  const createdAt = new Date(value.createdAt);
  if (Number.isNaN(createdAt.getTime())) return null;
  return createUsageEvent({
    ...value,
    id: String(value.id),
    createdAt: createdAt.toISOString(),
  });
}

export function mergeUsageEvents(importedEvents, storage = globalThis.localStorage) {
  const incoming = Array.isArray(importedEvents) ? importedEvents : [];
  const existing = loadUsageEvents(storage);
  const knownIds = new Set(existing.map((event) => String(event?.id || "")).filter(Boolean));
  let added = 0;
  let duplicate = 0;
  let invalid = 0;

  for (const candidate of incoming) {
    const event = normalizeImportedEvent(candidate);
    if (!event) {
      invalid += 1;
      continue;
    }
    if (knownIds.has(event.id)) {
      duplicate += 1;
      continue;
    }
    recordUsageEvent(event, storage);
    knownIds.add(event.id);
    added += 1;
  }

  return {
    added,
    duplicate,
    invalid,
    total: loadUsageEvents(storage).length,
  };
}

export function summarizeUsageByUser(events = [], now = new Date()) {
  const targetMonth = monthKey(now);
  const groups = new Map();

  for (const event of events) {
    if (monthKey(event?.createdAt) !== targetMonth) continue;
    const userLabel = String(event?.userLabel || "").trim() || "사용자 미지정";
    if (!groups.has(userLabel)) {
      groups.set(userLabel, {
        userLabel,
        events: 0,
        sttCalls: 0,
        aiCalls: 0,
        durationSeconds: 0,
        estimatedCostKrw: 0,
      });
    }
    const summary = groups.get(userLabel);
    summary.events += 1;
    summary.durationSeconds += Math.max(0, finiteNumber(event?.audioSeconds ?? event?.durationSeconds));
    summary.estimatedCostKrw += Math.max(0, finiteNumber(event?.estimatedCostKrw));
    const service = event?.service || event?.category;
    if (service === "stt") summary.sttCalls += 1;
    if (service === "ai") summary.aiCalls += 1;
  }

  return [...groups.values()].sort((a, b) => {
    if (b.estimatedCostKrw !== a.estimatedCostKrw) return b.estimatedCostKrw - a.estimatedCostKrw;
    return a.userLabel.localeCompare(b.userLabel, "ko-KR");
  });
}
