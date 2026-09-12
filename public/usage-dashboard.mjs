import {
  formatDurationCompact,
  formatKrw,
  loadUsageEvents,
} from "./usage-meter.mjs";
import {
  featureLabel,
  serviceLabel,
  summarizeUsageDashboard,
} from "./usage-dashboard-model.mjs";

const settingsCard = document.getElementById("settingsCard");
const usageSummary = document.getElementById("usageSummary");
let dashboardSection = null;
let dashboardBody = null;

function stat(label, value, detail = "") {
  const box = document.createElement("div");
  box.className = "usage-dashboard-stat";
  const name = document.createElement("span");
  name.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  box.append(name, strong);
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    box.append(small);
  }
  return box;
}

function row(label, cost, detail = "") {
  const item = document.createElement("div");
  item.className = "usage-dashboard-row";
  const left = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = label;
  left.append(title);
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    left.append(small);
  }
  const right = document.createElement("strong");
  right.className = "usage-dashboard-cost";
  right.textContent = formatKrw(cost);
  item.append(left, right);
  return item;
}

function subsection(titleText, items, mapper) {
  const section = document.createElement("div");
  section.className = "usage-dashboard-subsection";
  const title = document.createElement("h4");
  title.textContent = titleText;
  section.append(title);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "usage-dashboard-empty";
    empty.textContent = "이번 달 기록이 없습니다.";
    section.append(empty);
    return section;
  }
  items.forEach((item) => section.append(mapper(item)));
  return section;
}

function ensureDashboard() {
  if (dashboardSection?.isConnected) return;
  if (!settingsCard) return;
  dashboardSection = document.createElement("section");
  dashboardSection.className = "settings-section usage-dashboard";
  const title = document.createElement("h3");
  title.textContent = "관리자 사용량 · 원가";
  const note = document.createElement("p");
  note.className = "settings-note";
  note.textContent = "현재는 이 기기에 저장되었거나 JSON으로 가져온 두 개발자의 usage_events 합산 기준입니다. 중앙 자동동기화는 업무수첩 전용 DB 확정 후 연결합니다.";
  dashboardBody = document.createElement("div");
  dashboardBody.className = "usage-dashboard-body";
  dashboardSection.append(title, note, dashboardBody);

  const rateSection = [...settingsCard.querySelectorAll(".settings-section")]
    .find((section) => section.querySelector("h3")?.textContent?.includes("STT 참고 비용"));
  if (rateSection) settingsCard.insertBefore(dashboardSection, rateSection);
  else settingsCard.append(dashboardSection);
}

function render() {
  ensureDashboard();
  if (!dashboardBody) return;
  const dashboard = summarizeUsageDashboard(loadUsageEvents());
  const total = dashboard.total;
  dashboardBody.replaceChildren();

  const top = document.createElement("div");
  top.className = "usage-dashboard-stats";
  top.append(
    stat("전체 예상원가", formatKrw(total.estimatedCostKrw), `${total.events}개 이벤트`),
    stat("STT 사용시간", formatDurationCompact(total.audioSeconds), `${total.sttCalls}회 호출`),
    stat("AI 호출", `${total.aiCalls}회`, `API 호출 합계 ${Math.round(total.apiCalls)}회`),
    stat("실패", `${total.failed}건`, total.actualCostEvents ? `실제비용 확인 ${total.actualCostEvents}건` : "실제 청구 연동 전"),
  );
  dashboardBody.append(top);

  dashboardBody.append(subsection("개발자별", dashboard.byUser, (item) => row(
    item.key,
    item.estimatedCostKrw,
    `STT ${formatDurationCompact(item.audioSeconds)} · 이벤트 ${item.events}건${item.failed ? ` · 실패 ${item.failed}` : ""}`,
  )));

  dashboardBody.append(subsection("서비스별", dashboard.byService, (item) => row(
    serviceLabel(item.key),
    item.estimatedCostKrw,
    `${item.events}건 · API ${Math.round(item.apiCalls)}회${item.audioSeconds ? ` · ${formatDurationCompact(item.audioSeconds)}` : ""}`,
  )));

  dashboardBody.append(subsection("기능별", dashboard.byFeature, (item) => row(
    featureLabel(item.key),
    item.estimatedCostKrw,
    `${item.events}건${item.failed ? ` · 실패 ${item.failed}` : ""}`,
  )));

  dashboardBody.append(subsection("업무 단위 평균원가", dashboard.workUnits, (item) => row(
    item.type === "call" ? `통화 ${item.count}건` : item.type === "meeting" ? `회의 ${item.count}건` : `${item.type} ${item.count}건`,
    item.averageCostKrw,
    `건당 평균 · 전체 ${formatKrw(item.estimatedCostKrw)}${item.averageAudioSeconds ? ` · 평균 ${formatDurationCompact(item.averageAudioSeconds)}` : ""}`,
  )));
}

ensureDashboard();
render();

document.getElementById("settingsOpen")?.addEventListener("click", () => setTimeout(render, 0));
if (usageSummary && typeof MutationObserver !== "undefined") {
  const observer = new MutationObserver(() => queueMicrotask(render));
  observer.observe(usageSummary, { childList: true, subtree: true, characterData: true });
}
