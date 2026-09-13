import { extractScheduleFromText } from "./schedule-extract.mjs";

const ACTION_TYPES = new Set(["task", "schedule", "follow_up", "decision"]);
const MAX_KEY_POINTS = 20;
const MAX_ACTIONS = 30;
const MAX_CONTACTS = 20;
const MAX_REPORT_ITEMS = 20;

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

function validDateOnly(raw) {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validDateTime(raw) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:\d{2}|Z)$/.test(raw)) return false;
  const datePart = raw.slice(0, 10);
  if (!validDateOnly(datePart)) return false;
  const timeMatch = raw.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!timeMatch) return false;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return false;
  return Number.isFinite(new Date(raw).getTime());
}

function validDueStart(value, dueHasTime) {
  const raw = text(value, 64);
  if (!raw) return "";
  return dueHasTime ? (validDateTime(raw) ? raw : "") : (validDateOnly(raw) ? raw : "");
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

function normalizeReport(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    headline: text(source.headline || fallback.title, 300),
    overview: text(source.overview || fallback.summary, 6000),
    discussionPoints: uniqueTexts(source.discussionPoints?.length ? source.discussionPoints : fallback.keyPoints, MAX_REPORT_ITEMS),
    counterpartRequests: uniqueTexts(source.counterpartRequests, MAX_REPORT_ITEMS),
    userCommitments: uniqueTexts(source.userCommitments, MAX_REPORT_ITEMS),
    decisions: uniqueTexts(source.decisions?.length ? source.decisions : fallback.decisions, MAX_REPORT_ITEMS),
    openQuestions: uniqueTexts(source.openQuestions, MAX_REPORT_ITEMS),
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

  const title = text(value.title, 200);
  const summary = text(value.summary, 6000);
  const keyPoints = uniqueTexts(value.keyPoints);
  const decisions = actions.filter((item) => item.type === "decision").map((item) => item.content);
  const report = normalizeReport(value.report, { title, summary, keyPoints, decisions });

  return {
    analysisVersion: "v2",
    title,
    summary,
    keyPoints,
    report,
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
