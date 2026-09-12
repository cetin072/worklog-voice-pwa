const SETTINGS_KEY = "worklog.usage.settings.v1";
const EVENTS_KEY = "worklog.usage.events.v1";
const SEOUL_TZ = "Asia/Seoul";

export const DEFAULT_STT_RATES = Object.freeze({
  "openai-gpt-transcribe": { provider: "OpenAI", model: "gpt-transcribe", currency: "USD", perMinute: 0.0045 },
  "clova-speech-basic": { provider: "NAVER CLOVA Speech", model: "Long-form basic", currency: "KRW", perMinute: 20 },
  "assemblyai-universal-2": { provider: "AssemblyAI", model: "Universal-2", currency: "USD", perMinute: 0.0025 },
});

export const DEFAULT_USAGE_SETTINGS = Object.freeze({
  userLabel: "",
  monthlyBudgetKrw: 30000,
  warningPercent: 70,
  usdKrw: 1400,
  paidFeaturesLocked: true,
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function nullableNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeUsageSettings(value = {}) {
  const monthlyBudgetKrw = Math.max(0, Math.round(finiteNumber(value.monthlyBudgetKrw, DEFAULT_USAGE_SETTINGS.monthlyBudgetKrw)));
  const warningPercent = Math.min(100, Math.max(1, Math.round(finiteNumber(value.warningPercent, DEFAULT_USAGE_SETTINGS.warningPercent))));
  const usdKrw = Math.max(0, finiteNumber(value.usdKrw, DEFAULT_USAGE_SETTINGS.usdKrw));
  return {
    userLabel: String(value.userLabel || "").trim().slice(0, 40),
    monthlyBudgetKrw,
    warningPercent,
    usdKrw,
    paidFeaturesLocked: true,
  };
}

export function estimateSttCost(rateId, durationSeconds, options = {}) {
  const rate = DEFAULT_STT_RATES[rateId];
  if (!rate) return null;
  const seconds = nonNegativeNumber(durationSeconds);
  const minutes = seconds / 60;
  const nativeCost = minutes * rate.perMinute;
  const usdKrw = Math.max(0, finiteNumber(options.usdKrw, DEFAULT_USAGE_SETTINGS.usdKrw));
  const estimatedKrw = rate.currency === "KRW" ? nativeCost : nativeCost * usdKrw;
  return {
    rateId,
    provider: rate.provider,
    model: rate.model,
    currency: rate.currency,
    perMinute: rate.perMinute,
    durationSeconds: seconds,
    nativeCost,
    estimatedKrw,
  };
}

export function monthKey(date = new Date()) {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(target);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  return year && month ? `${year}-${month}` : "";
}

export function createUsageEvent(input = {}) {
  const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
  const validCreatedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
  const id = String(input.id || `${validCreatedAt.getTime()}-${Math.random().toString(36).slice(2, 10)}`);
  const service = String(input.service || input.category || "unknown");
  const audioSeconds = nonNegativeNumber(input.audioSeconds ?? input.durationSeconds);
  return {
    id,
    eventKey: String(input.eventKey || id),
    requestId: String(input.requestId || ""),
    createdAt: validCreatedAt.toISOString(),
    userLabel: String(input.userLabel || "").trim().slice(0, 40),
    feature: String(input.feature || "unknown"),
    service,
    category: service,
    provider: String(input.provider || ""),
    model: String(input.model || ""),
    audioSeconds,
    durationSeconds: audioSeconds,
    inputTokens: Math.round(nonNegativeNumber(input.inputTokens)),
    outputTokens: Math.round(nonNegativeNumber(input.outputTokens)),
    imageCount: Math.round(nonNegativeNumber(input.imageCount)),
    storageBytes: Math.round(nonNegativeNumber(input.storageBytes)),
    apiCalls: Math.round(nonNegativeNumber(input.apiCalls, 1)),
    nativeCost: nonNegativeNumber(input.nativeCost),
    nativeCurrency: String(input.nativeCurrency || "KRW").toUpperCase().slice(0, 8),
    estimatedCostKrw: nonNegativeNumber(input.estimatedCostKrw),
    actualCostKrw: nullableNonNegativeNumber(input.actualCostKrw),
    relatedType: String(input.relatedType || ""),
    relatedId: String(input.relatedId || ""),
    providerRequestId: String(input.providerRequestId || ""),
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {},
    status: ["success", "failed", "cancelled"].includes(input.status) ? input.status : "success",
  };
}

export function summarizeUsage(events = [], now = new Date()) {
  const currentMonth = monthKey(now);
  const monthEvents = events.filter((event) => monthKey(event?.createdAt) === currentMonth);
  return monthEvents.reduce((summary, event) => {
    summary.events += 1;
    summary.durationSeconds += nonNegativeNumber(event.audioSeconds ?? event.durationSeconds);
    summary.inputTokens += nonNegativeNumber(event.inputTokens);
    summary.outputTokens += nonNegativeNumber(event.outputTokens);
    summary.imageCount += nonNegativeNumber(event.imageCount);
    summary.storageBytes += nonNegativeNumber(event.storageBytes);
    summary.apiCalls += nonNegativeNumber(event.apiCalls, 1);
    summary.estimatedCostKrw += nonNegativeNumber(event.estimatedCostKrw);
    const actual = nullableNonNegativeNumber(event.actualCostKrw);
    if (actual !== null) {
      summary.actualCostKrw += actual;
      summary.actualCostEvents += 1;
    }
    const service = event.service || event.category;
    if (service === "stt") summary.sttCalls += 1;
    if (service === "ai") summary.aiCalls += 1;
    if (event.status === "failed") summary.failed += 1;
    return summary;
  }, {
    month: currentMonth,
    events: 0,
    sttCalls: 0,
    aiCalls: 0,
    failed: 0,
    durationSeconds: 0,
    inputTokens: 0,
    outputTokens: 0,
    imageCount: 0,
    storageBytes: 0,
    apiCalls: 0,
    estimatedCostKrw: 0,
    actualCostKrw: 0,
    actualCostEvents: 0,
  });
}

export function budgetState(summary, settings) {
  const normalized = normalizeUsageSettings(settings);
  const budget = normalized.monthlyBudgetKrw;
  const spent = nonNegativeNumber(summary?.estimatedCostKrw);
  const percent = budget > 0 ? (spent / budget) * 100 : 0;
  return {
    budgetKrw: budget,
    spentKrw: spent,
    percent,
    warning: budget > 0 && percent >= normalized.warningPercent,
    exceeded: budget > 0 && percent >= 100,
  };
}

function safeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadUsageSettings(storage = globalThis.localStorage) {
  if (!storage) return { ...DEFAULT_USAGE_SETTINGS };
  try {
    return normalizeUsageSettings(safeParse(storage.getItem(SETTINGS_KEY), {}));
  } catch {
    return { ...DEFAULT_USAGE_SETTINGS };
  }
}

export function saveUsageSettings(settings, storage = globalThis.localStorage) {
  const normalized = normalizeUsageSettings(settings);
  if (storage) storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadUsageEvents(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const parsed = safeParse(storage.getItem(EVENTS_KEY), []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((event) => event && typeof event === "object");
  } catch {
    return [];
  }
}

export function recordUsageEvent(input, storage = globalThis.localStorage) {
  const event = createUsageEvent(input);
  const events = loadUsageEvents(storage);
  events.push(event);
  const trimmed = events.slice(-1000);
  if (storage) storage.setItem(EVENTS_KEY, JSON.stringify(trimmed));
  return event;
}

export function clearUsageEvents(storage = globalThis.localStorage) {
  if (storage) storage.removeItem(EVENTS_KEY);
}

export function formatDurationCompact(seconds) {
  const total = Math.max(0, Math.round(finiteNumber(seconds, 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours) return `${hours}시간 ${minutes}분`;
  if (minutes) return `${minutes}분 ${remain}초`;
  return `${remain}초`;
}

export function formatKrw(value) {
  return `${Math.round(Math.max(0, finiteNumber(value, 0))).toLocaleString("ko-KR")}원`;
}
