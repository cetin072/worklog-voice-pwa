import {
  DEFAULT_STT_RATES,
  budgetState,
  clearUsageEvents,
  estimateSttCost,
  formatDurationCompact,
  formatKrw,
  loadUsageEvents,
  loadUsageSettings,
  recordUsageEvent,
  saveUsageSettings,
  summarizeUsage,
} from "./usage-meter.mjs";
import {
  mergeUsageEvents,
  summarizeUsageByUser,
} from "./usage-sync.mjs";

const openButton = document.getElementById("settingsOpen");
const closeButton = document.getElementById("settingsClose");
const card = document.getElementById("settingsCard");
const form = document.getElementById("settingsForm");
const userLabel = document.getElementById("settingsUserLabel");
const monthlyBudget = document.getElementById("settingsMonthlyBudget");
const warningPercent = document.getElementById("settingsWarningPercent");
const usdKrw = document.getElementById("settingsUsdKrw");
const summaryTarget = document.getElementById("usageSummary");
const budgetTarget = document.getElementById("usageBudgetState");
const ratesTarget = document.getElementById("usageRateList");
const exportButton = document.getElementById("usageExport");
const clearButton = document.getElementById("usageClear");
const status = document.getElementById("settingsStatus");

let userBreakdownTarget = null;
let importButton = null;
let importInput = null;

function ensureUsageMergeUi() {
  if (!summaryTarget) return;

  if (!userBreakdownTarget) {
    const section = document.createElement("div");
    section.className = "settings-section";
    const heading = document.createElement("h3");
    heading.textContent = "개발자별 사용량";
    const note = document.createElement("p");
    note.className = "settings-note";
    note.textContent = "현재는 각 기기의 사용량 JSON을 가져와 합산합니다. 같은 이벤트 ID는 자동으로 중복 제외합니다.";
    userBreakdownTarget = document.createElement("div");
    userBreakdownTarget.className = "rate-list";
    section.append(heading, note, userBreakdownTarget);
    summaryTarget.parentElement?.append(section);
  }

  const actions = exportButton?.parentElement;
  if (actions && !importButton) {
    importButton = document.createElement("button");
    importButton.type = "button";
    importButton.textContent = "다른 개발자 사용량 가져오기";

    importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.hidden = true;

    actions.insertBefore(importButton, clearButton || null);
    actions.append(importInput);

    importButton.addEventListener("click", () => importInput?.click());
    importInput.addEventListener("change", handleUsageImport);
  }
}

function settingsFromForm() {
  return {
    userLabel: userLabel?.value || "",
    monthlyBudgetKrw: monthlyBudget?.value || 0,
    warningPercent: warningPercent?.value || 70,
    usdKrw: usdKrw?.value || 0,
  };
}

function fillForm(settings) {
  if (userLabel) userLabel.value = settings.userLabel || "";
  if (monthlyBudget) monthlyBudget.value = settings.monthlyBudgetKrw;
  if (warningPercent) warningPercent.value = settings.warningPercent;
  if (usdKrw) usdKrw.value = settings.usdKrw;
}

function stat(label, value) {
  const item = document.createElement("div");
  item.className = "usage-stat";
  const name = document.createElement("span");
  name.textContent = label;
  const number = document.createElement("strong");
  number.textContent = value;
  item.append(name, number);
  return item;
}

function renderUserBreakdown(events) {
  ensureUsageMergeUi();
  if (!userBreakdownTarget) return;
  const summaries = summarizeUsageByUser(events);
  userBreakdownTarget.replaceChildren();

  if (!summaries.length) {
    const empty = document.createElement("p");
    empty.className = "settings-note";
    empty.textContent = "아직 이번 달 사용량 기록이 없습니다.";
    userBreakdownTarget.append(empty);
    return;
  }

  for (const item of summaries) {
    const row = document.createElement("div");
    row.className = "rate-row";
    const left = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.userLabel;
    const detail = document.createElement("small");
    detail.textContent = `STT ${item.sttCalls}건 · AI ${item.aiCalls}건 · ${formatDurationCompact(item.durationSeconds)}`;
    left.append(title, detail);
    const right = document.createElement("div");
    right.className = "rate-cost";
    right.textContent = formatKrw(item.estimatedCostKrw);
    row.append(left, right);
    userBreakdownTarget.append(row);
  }
}

function renderSummary() {
  if (!summaryTarget || !budgetTarget) return;
  const settings = loadUsageSettings();
  const events = loadUsageEvents();
  const summary = summarizeUsage(events);
  const budget = budgetState(summary, settings);

  summaryTarget.replaceChildren(
    stat("STT 사용시간", formatDurationCompact(summary.durationSeconds)),
    stat("STT 호출", `${summary.sttCalls}건`),
    stat("AI 호출", `${summary.aiCalls}건`),
    stat("전체 예상비용", formatKrw(summary.estimatedCostKrw)),
  );

  budgetTarget.className = "usage-budget";
  if (budget.exceeded) budgetTarget.classList.add("exceeded");
  else if (budget.warning) budgetTarget.classList.add("warning");

  if (budget.budgetKrw <= 0) {
    budgetTarget.textContent = "월 예산이 설정되지 않았습니다.";
  } else {
    budgetTarget.textContent = `두 개발자 합산 기준 · 월 예산 ${formatKrw(budget.budgetKrw)} 중 ${formatKrw(budget.spentKrw)} 사용 예상 · ${budget.percent.toFixed(1)}%`;
  }

  exportButton.disabled = events.length === 0;
  clearButton.disabled = events.length === 0;
  renderUserBreakdown(events);
}

function renderRates() {
  if (!ratesTarget) return;
  const settings = loadUsageSettings();
  ratesTarget.replaceChildren();
  Object.entries(DEFAULT_STT_RATES).forEach(([rateId, rate]) => {
    const row = document.createElement("div");
    row.className = "rate-row";
    const left = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = rate.provider;
    const model = document.createElement("small");
    model.textContent = rate.model;
    left.append(title, model);

    const cost = estimateSttCost(rateId, 3600, { usdKrw: settings.usdKrw });
    const right = document.createElement("div");
    right.className = "rate-cost";
    right.textContent = cost ? `1시간 ≈ ${formatKrw(cost.estimatedKrw)}` : "-";
    row.append(left, right);
    ratesTarget.append(row);
  });
}

function renderAll() {
  ensureUsageMergeUi();
  const settings = loadUsageSettings();
  fillForm(settings);
  renderSummary();
  renderRates();
}

function openSettings() {
  if (!card) return;
  card.hidden = false;
  renderAll();
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSettings() {
  if (card) card.hidden = true;
}

function exportUsage() {
  const payload = {
    format: "worklog-usage-v1",
    exportedAt: new Date().toISOString(),
    settings: loadUsageSettings(),
    events: loadUsageEvents(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `worklog-usage-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function handleUsageImport() {
  const file = importInput?.files?.[0];
  if (!file) return;
  importInput.value = "";

  if (file.size > 2 * 1024 * 1024) {
    status.textContent = "사용량 JSON은 2MB 이하 파일만 가져올 수 있습니다.";
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const events = Array.isArray(parsed) ? parsed : parsed?.events;
    if (!Array.isArray(events)) throw new Error("events 배열 없음");
    const result = mergeUsageEvents(events);
    renderSummary();
    status.textContent = `사용량 ${result.added}건 추가 · 중복 ${result.duplicate}건 제외${result.invalid ? ` · 형식 오류 ${result.invalid}건 제외` : ""}.`;
  } catch {
    status.textContent = "사용량 JSON을 읽지 못했습니다. 업무수첩에서 내보낸 파일인지 확인하세요.";
  }
}

openButton?.addEventListener("click", openSettings);
closeButton?.addEventListener("click", closeSettings);
form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const saved = saveUsageSettings(settingsFromForm());
  fillForm(saved);
  renderSummary();
  renderRates();
  status.textContent = "설정을 이 기기에 저장했습니다.";
});
exportButton?.addEventListener("click", exportUsage);
clearButton?.addEventListener("click", () => {
  if (!confirm("이 기기에 저장된 사용량 기록을 모두 비울까요? 가져온 다른 개발자 사용량도 함께 지워집니다. 실제 통화녹음이나 Notion 기록은 삭제되지 않습니다.")) return;
  clearUsageEvents();
  renderSummary();
  status.textContent = "이 기기의 사용량 기록을 비웠습니다.";
});

window.WorklogUsageMeter = Object.freeze({
  getSettings: () => loadUsageSettings(),
  getEvents: () => loadUsageEvents(),
  record: (input) => {
    const settings = loadUsageSettings();
    const event = recordUsageEvent({ ...input, userLabel: input?.userLabel || settings.userLabel });
    renderSummary();
    return event;
  },
  merge: (events) => {
    const result = mergeUsageEvents(events);
    renderSummary();
    return result;
  },
  estimateSttCost: (rateId, durationSeconds) => estimateSttCost(rateId, durationSeconds, { usdKrw: loadUsageSettings().usdKrw }),
  paidFeaturesLocked: () => true,
});

renderAll();
