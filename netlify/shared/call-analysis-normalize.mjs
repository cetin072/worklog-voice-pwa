import { extractScheduleFromText } from "./schedule-extract.mjs";

const ACTION_TYPES = new Set(["task", "schedule", "follow_up", "decision"]);
const MAX_KEY_POINTS = 20;
const MAX_ACTIONS = 30;
const MAX_CONTACTS = 20;

function text(value, max = 4000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function confidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, number));
}

function uniqueTexts(values, maxItems = MAX_KEY_POINTS) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = text(value, 1000);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function validDueStart(value, dueHasTime) {
  const raw = text(value, 64);
  if (!raw) return "";
  if (dueHasTime) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:\d{2}|Z)$/.test(raw) ? raw : "";
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function resolveScheduleCandidate(action, recordedAt) {
  const explicitHasTime = Boolean(action?.dueHasTime);
  const explicitDueStart = validDueStart(action?.dueStart, explicitHasTime);
  if (explicitDueStart) {
    return {
      dueStart: explicitDueStart,
      dueHasTime: explicitHasTime,
      dueText: text(action?.dueText, 500),
      needsReview: false,
      cleanedContent: text(action?.content, 2000),
    };
  }

  const dueText = text(action?.dueText, 500);
  const content = text(action?.content, 2000);
  const source = dueText || content;
  if (!source) {
    return { dueStart: "", dueHasTime: false, dueText, needsReview: true, cleanedContent: content };
  }

  const parsed = extractScheduleFromText(source, recordedAt);
  if (!parsed.matched || !parsed.dueStart) {
    return { dueStart: "", dueHasTime: false, dueText, needsReview: true, cleanedContent: content };
  }

  const cleanedContent = dueText ? content : parsed.text;
  return {
    dueStart: parsed.dueStart,
    dueHasTime: parsed.hasTime,
    dueText: dueText || source,
    needsReview: false,
    cleanedContent: cleanedContent || content,
  };
}

function normalizeAction(value, recordedAt) {
  if (!value || typeof value !== "object") return null;
  const type = text(value.type, 40);
  if (!ACTION_TYPES.has(type)) return null;

  let content = text(value.content, 2000);
  if (!content) return null;

  let dueStart = "";
  let dueHasTime = false;
  let dueText = text(value.dueText, 500);
  let needsReview = false;

  if (type === "schedule") {
    const schedule = resolveScheduleCandidate(value, recordedAt);
    dueStart = schedule.dueStart;
    dueHasTime = schedule.dueHasTime;
    dueText = schedule.dueText;
    needsReview = schedule.needsReview;
    content = schedule.cleanedContent || content;
  }

  return {
    type,
    content,
    dueStart,
    dueHasTime,
    dueText,
    confidence: confidence(value.confidence),
    confirmed: false,
    needsReview: type === "schedule" ? needsReview : false,
    sourceExcerpt: text(value.sourceExcerpt, 1000),
  };
}

function normalizeContact(value) {
  if (!value || typeof value !== "object") return null;
  const name = text(value.name, 200);
  const phone = text(value.phone, 80);
  const role = text(value.role, 200);
  if (!name && !phone) return null;
  return {
    name,
    phone,
    role,
    confidence: confidence(value.confidence),
  };
}

export function normalizeCallAnalysisResult(value = {}, options = {}) {
  const recordedAt = options.recordedAt || new Date();
  const actions = [];
  for (const candidate of Array.isArray(value.actions) ? value.actions : []) {
    const normalized = normalizeAction(candidate, recordedAt);
    if (!normalized) continue;
    actions.push(normalized);
    if (actions.length >= MAX_ACTIONS) break;
  }

  const contacts = [];
  for (const candidate of Array.isArray(value.contacts) ? value.contacts : []) {
    const normalized = normalizeContact(candidate);
    if (!normalized) continue;
    contacts.push(normalized);
    if (contacts.length >= MAX_CONTACTS) break;
  }

  return {
    analysisVersion: "v1",
    title: text(value.title, 200),
    summary: text(value.summary, 6000),
    keyPoints: uniqueTexts(value.keyPoints),
    actions,
    contacts,
  };
}

export function splitCallAnalysisActions(result = {}) {
  const actions = Array.isArray(result.actions) ? result.actions : [];
  return {
    tasks: actions.filter((item) => item.type === "task"),
    schedules: actions.filter((item) => item.type === "schedule"),
    followUps: actions.filter((item) => item.type === "follow_up"),
    decisions: actions.filter((item) => item.type === "decision"),
  };
}
