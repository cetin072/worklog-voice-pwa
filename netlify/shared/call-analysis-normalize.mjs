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
  if (value === null || value === undefined || value === "") return null;
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
  const match = raw.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  return hour <= 23 && minute <= 59 && second <= 59 && Number.isFinite(new Date(raw).getTime());
}

function normalizeSchedule(action, recordedAt) {
  const dueHasTime = Boolean(action?.dueHasTime);
  const explicit = text(action?.dueStart, 64);
  const validExplicit = dueHasTime ? validDateTime(explicit) : validDateOnly(explicit);
  const dueText = text(action?.dueText, 500);
  const content = text(action?.content, 2000);

  if (explicit && validExplicit) {
    return { dueStart: explicit, dueHasTime, dueText, needsReview: false, content };
  }

  const source = dueText || content;
  if (!source) return { dueStart: "", dueHasTime: false, dueText, needsReview: true, content };
  const parsed = extractScheduleFromText(source, recordedAt);
  if (!parsed.matched || !parsed.dueStart) {
    return { dueStart: "", dueHasTime: false, dueText, needsReview: true, content };
  }
  return {
    dueStart: parsed.dueStart,
    dueHasTime: parsed.hasTime,
    dueText: dueText || source,
    needsReview: false,
    content: dueText ? content : (parsed.text || content),
  };
}

function normalizeAction(value, recordedAt) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = text(value.type, 40);
  if (!ACTION_TYPES.has(type)) return null;
  let content = text(value.content, 2000);
  if (!content) return null;

  let dueStart = "";
  let dueHasTime = false;
  let dueText = text(value.dueText, 500);
  let needsReview = false;
  if (type === "schedule") {
    const schedule = normalizeSchedule(value, recordedAt);
    dueStart = schedule.dueStart;
    dueHasTime = schedule.dueHasTime;
    dueText = schedule.dueText;
    needsReview = schedule.needsReview;
    content = schedule.content || content;
  }

  return Object.freeze({
    type,
    content,
    dueStart,
    dueHasTime,
    dueText,
    confidence: confidence(value.confidence),
    confirmed: false,
    needsReview: type === "schedule" ? needsReview : false,
    sourceExcerpt: text(value.sourceExcerpt, 1000),
  });
}

function normalizeContact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = text(value.name, 200);
  const phone = text(value.phone, 80);
  const role = text(value.role, 200);
  if (!name && !phone) return null;
  return Object.freeze({ name, phone, role, confidence: confidence(value.confidence) });
}

function normalizeReport(value = {}, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze({
    headline: text(source.headline || fallback.title, 300),
    overview: text(source.overview || fallback.summary, 6000),
    discussionPoints: Object.freeze(uniqueTexts(source.discussionPoints?.length ? source.discussionPoints : fallback.keyPoints, MAX_REPORT_ITEMS)),
    counterpartRequests: Object.freeze(uniqueTexts(source.counterpartRequests, MAX_REPORT_ITEMS)),
    userCommitments: Object.freeze(uniqueTexts(source.userCommitments, MAX_REPORT_ITEMS)),
    decisions: Object.freeze(uniqueTexts(source.decisions?.length ? source.decisions : fallback.decisions, MAX_REPORT_ITEMS)),
    openQuestions: Object.freeze(uniqueTexts(source.openQuestions, MAX_REPORT_ITEMS)),
  });
}

export function normalizeCallAnalysisResult(value = {}, options = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const recordedAt = options.recordedAt || new Date();
  const actions = [];
  for (const candidate of Array.isArray(source.actions) ? source.actions : []) {
    const normalized = normalizeAction(candidate, recordedAt);
    if (normalized) actions.push(normalized);
    if (actions.length >= MAX_ACTIONS) break;
  }

  const contacts = [];
  for (const candidate of Array.isArray(source.contacts) ? source.contacts : []) {
    const normalized = normalizeContact(candidate);
    if (normalized) contacts.push(normalized);
    if (contacts.length >= MAX_CONTACTS) break;
  }

  const title = text(source.title, 200);
  const summary = text(source.summary, 6000);
  const keyPoints = uniqueTexts(source.keyPoints);
  const decisions = actions.filter((item) => item.type === "decision").map((item) => item.content);
  const report = normalizeReport(source.report, { title, summary, keyPoints, decisions });

  return Object.freeze({
    analysisVersion: "v2",
    title,
    summary,
    keyPoints: Object.freeze(keyPoints),
    report,
    actions: Object.freeze(actions),
    contacts: Object.freeze(contacts),
  });
}

export function splitCallAnalysisActions(result = {}) {
  const actions = Array.isArray(result.actions) ? result.actions : [];
  return Object.freeze({
    tasks: Object.freeze(actions.filter((item) => item.type === "task")),
    schedules: Object.freeze(actions.filter((item) => item.type === "schedule")),
    followUps: Object.freeze(actions.filter((item) => item.type === "follow_up")),
    decisions: Object.freeze(actions.filter((item) => item.type === "decision")),
  });
}
