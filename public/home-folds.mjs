import {
  HOME_FOLD_DEFAULT,
  HOME_FOLD_SECTION,
  loadHomeFoldDefault,
  saveHomeFoldDefault,
} from "./home-folds-state.mjs";

const FOLD_SECTIONS = [
  {
    sectionId: HOME_FOLD_SECTION.CALLS,
    settingId: "settingsHomeFoldCalls",
    cardId: "callInboxCard",
    headSelector: ".call-inbox-head",
    name: "통화녹음",
    settingLabel: "통화녹음 기본 상태",
  },
  {
    sectionId: HOME_FOLD_SECTION.BRIEFING,
    settingId: "settingsHomeFoldBriefing",
    cardId: "briefingCard",
    headSelector: ".briefing-head",
    name: "브리핑·일정",
    settingLabel: "브리핑·일정 기본 상태",
  },
];

const foldControllers = [];

function createToggle(name) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "home-fold-toggle";
  button.innerHTML = '<span class="home-fold-chevron" aria-hidden="true">⌄</span>';
  button.setAttribute("aria-label", `${name} 펼치기`);
  return button;
}

function setupFoldSection(config) {
  const card = document.getElementById(config.cardId);
  const head = card?.querySelector(config.headSelector);
  if (!card || !head || card.dataset.foldReady === "true") return null;

  const body = document.createElement("div");
  body.className = "home-fold-body";
  [...card.children].filter((child) => child !== head).forEach((child) => body.append(child));
  card.append(body);

  const toggle = createToggle(config.name);
  head.append(toggle);
  card.classList.add("home-fold-card");
  card.dataset.foldReady = "true";

  const setExpanded = (expanded) => {
    body.hidden = !expanded;
    card.classList.toggle("is-collapsed", !expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${config.name} ${expanded ? "접기" : "펼치기"}`);
    toggle.querySelector(".home-fold-chevron").textContent = expanded ? "⌃" : "⌄";
  };

  const toggleExpanded = () => setExpanded(body.hidden);
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleExpanded();
  });

  head.classList.add("home-fold-head");
  head.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    toggleExpanded();
  });

  const controller = { ...config, card, head, body, toggle, setExpanded };
  foldControllers.push(controller);
  return controller;
}

function applySectionDefault(sectionId, defaultState) {
  const controller = foldControllers.find((item) => item.sectionId === sectionId);
  if (!controller) return;
  controller.setExpanded(defaultState === HOME_FOLD_DEFAULT.EXPANDED);
}

function applySavedDefaults() {
  FOLD_SECTIONS.forEach((config) => {
    applySectionDefault(config.sectionId, loadHomeFoldDefault(config.sectionId));
  });
}

function createSettingControl(config) {
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = config.settingLabel;
  const select = document.createElement("select");
  select.id = config.settingId;

  const collapsed = document.createElement("option");
  collapsed.value = HOME_FOLD_DEFAULT.COLLAPSED;
  collapsed.textContent = "기본 접기";
  const expanded = document.createElement("option");
  expanded.value = HOME_FOLD_DEFAULT.EXPANDED;
  expanded.textContent = "기본 펼치기";
  select.append(collapsed, expanded);
  select.value = loadHomeFoldDefault(config.sectionId);
  label.append(span, select);

  select.addEventListener("change", () => {
    const saved = saveHomeFoldDefault(config.sectionId, select.value);
    applySectionDefault(config.sectionId, saved);
    const status = document.getElementById("settingsStatus");
    if (status) {
      status.textContent = `${config.name} 영역을 ${saved === HOME_FOLD_DEFAULT.EXPANDED ? "기본 펼치기" : "기본 접기"}로 저장했습니다.`;
    }
  });

  return label;
}

function installSettingControls() {
  const grid = document.querySelector("#settingsForm .settings-grid");
  if (!grid) return;
  FOLD_SECTIONS.forEach((config) => {
    if (document.getElementById(config.settingId)) return;
    grid.append(createSettingControl(config));
  });
}

FOLD_SECTIONS.forEach(setupFoldSection);
installSettingControls();
applySavedDefaults();

import("./call-folder-guide.mjs").catch(() => {});
import("./settings-ux.mjs").catch(() => {});
