if (!document.querySelector('link[data-worklog-ux-refinement="true"]')) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/ux-refinement.css";
  link.dataset.worklogUxRefinement = "true";
  document.head.append(link);
}

const card = document.getElementById("settingsCard");
const form = document.getElementById("settingsForm");

function createCategory(id, title, description = "") {
  const section = document.createElement("section");
  section.id = id;
  section.className = "settings-category";
  const head = document.createElement("div");
  head.className = "settings-category-head";
  const heading = document.createElement("h3");
  heading.textContent = title;
  head.append(heading);
  if (description) {
    const note = document.createElement("p");
    note.textContent = description;
    head.append(note);
  }
  const body = document.createElement("div");
  body.className = "settings-category-body";
  section.append(head, body);
  return { section, body };
}

function topLevelSettingsSections() {
  if (!card) return [];
  return [...card.querySelectorAll(".settings-section")].filter((section) => {
    const parentSection = section.parentElement?.closest?.(".settings-section");
    return !parentSection;
  });
}

function findSection(text) {
  return topLevelSettingsSections().find((section) => section.querySelector("h3")?.textContent?.trim() === text) || null;
}

function moveBudgetFields(accountSection, targetGrid) {
  if (!accountSection || !targetGrid) return;
  ["settingsMonthlyBudget", "settingsWarningPercent", "settingsUsdKrw"].forEach((id) => {
    const label = document.getElementById(id)?.closest("label");
    if (label) targetGrid.append(label);
  });
}

function buildDisplaySection() {
  const labels = ["settingsHomeFoldCalls", "settingsHomeFoldBriefing"]
    .map((id) => document.getElementById(id)?.closest("label"))
    .filter(Boolean);
  if (!labels.length) return null;

  const section = document.createElement("section");
  section.className = "settings-section settings-section-compact";
  const title = document.createElement("h4");
  title.textContent = "메인 화면 기본 상태";
  const grid = document.createElement("div");
  grid.className = "settings-grid";
  labels.forEach((label) => grid.append(label));
  const note = document.createElement("p");
  note.className = "settings-note";
  note.textContent = "각 항목을 따로 설정할 수 있습니다. 예: 통화녹음은 접기, 브리핑·일정은 펼치기.";
  section.append(title, grid, note);
  return section;
}

function buildBudgetSection(accountSection) {
  const section = document.createElement("section");
  section.className = "settings-section settings-section-compact";
  const title = document.createElement("h4");
  title.textContent = "예산 · 계산 기준";
  const grid = document.createElement("div");
  grid.className = "settings-grid";
  section.append(title, grid);
  moveBudgetFields(accountSection, grid);
  return grid.children.length ? section : null;
}

function buildFolderSection() {
  const section = document.createElement("section");
  section.className = "settings-section settings-section-compact";
  const title = document.createElement("h4");
  title.textContent = "통화녹음 위치";
  const path = document.createElement("div");
  path.className = "settings-path-card";
  path.innerHTML = "<strong>내장 저장공간 → Recordings → TPhoneCallRecords</strong><small>현재 확인된 에이닷 전화 녹음 경로 · 기기에 따라 다를 수 있음</small>";
  section.append(title, path);
  return section;
}

function organizeSettings() {
  if (!card || !form || card.dataset.uxOrganized === "true") return;

  const accountSection = findSection("이 기기 사용자");
  const privacySection = findSection("통화 · 회의 개인정보");
  const usageSection = findSection("이번 달 사용량");
  const rateSection = findSection("STT 참고 비용");
  const dashboardSection = card.querySelector(".usage-dashboard");
  const paidLock = card.querySelector(".paid-lock");
  const saveButton = accountSection?.querySelector(".settings-save") || null;

  if (accountSection?.querySelector("h3")) accountSection.querySelector("h3").textContent = "사용자";

  const display = createCategory("settingsCategoryDisplay", "화면", "메인 화면에서 자주 보이는 영역의 기본 표시 상태를 항목별로 정합니다.");
  const user = createCategory("settingsCategoryUser", "사용자", "이 기기에서 기록되는 사용자 구분값을 설정합니다.");
  const call = createCategory("settingsCategoryCall", "통화 · 녹음", "통화녹음 위치와 개인정보 보관정책을 관리합니다.");
  const ai = createCategory("settingsCategoryAi", "AI · 비용", "유료 기능 잠금, 월 예산, 사용량과 예상원가를 확인합니다.");

  const displaySection = buildDisplaySection();
  if (displaySection) display.body.append(displaySection);

  if (accountSection) {
    const accountGrid = accountSection.querySelector(".settings-grid");
    if (accountGrid && accountGrid.children.length) user.body.append(accountSection);
  }

  call.body.append(buildFolderSection());
  if (privacySection) call.body.append(privacySection);

  if (paidLock) ai.body.append(paidLock);
  const budgetSection = buildBudgetSection(accountSection);
  if (budgetSection) ai.body.append(budgetSection);
  if (usageSection) ai.body.append(usageSection);
  if (dashboardSection && !usageSection?.contains(dashboardSection)) ai.body.append(dashboardSection);
  if (rateSection) ai.body.append(rateSection);

  form.replaceChildren();
  [display, user, call, ai].forEach(({ section, body }) => {
    if (body.children.length) form.append(section);
  });

  if (saveButton) {
    const actions = document.createElement("div");
    actions.className = "settings-global-actions";
    saveButton.textContent = "설정 저장";
    actions.append(saveButton);
    form.append(actions);
  }

  card.dataset.uxOrganized = "true";
}

organizeSettings();
