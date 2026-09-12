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
    stat("예상비용", formatKrw(summary.estimatedCostKrw)),
  );

  budgetTarget.className = "usage-budget";
  if (budget.exceeded) budgetTarget.classList.add("exceeded");
  else if (budget.warning) budgetTarget.classList.add("warning");

  if (budget.budgetKrw <= 0) {
    budgetTarget.textContent = "월 예산이 설정되지 않았습니다.";
  } else {
    budgetTarget.textContent = `월 예산 ${formatKrw(budget.budgetKrw)} 중 ${formatKrw(budget.spentKrw)} 사용 예상 · ${budget.percent.toFixed(1)}%`;
  }

  exportButton.disabled = events.length === 0;
  clearButton.disabled = events.length === 0;
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
  if (!confirm("이 기기에 저장된 사용량 기록을 모두 비울까요? 실제 통화녹음이나 Notion 기록은 삭제되지 않습니다.")) return;
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
  estimateSttCost: (rateId, durationSeconds) => estimateSttCost(rateId, durationSeconds, { usdKrw: loadUsageSettings().usdKrw }),
  paidFeaturesLocked: () => true,
});

renderAll();
