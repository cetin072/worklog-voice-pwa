import {
  HOME_FOLD_DEFAULT,
  loadHomeFoldDefault,
  saveHomeFoldDefault,
} from "./home-folds-state.mjs";

const FOLD_SECTIONS = [
  { cardId: "callInboxCard", headSelector: ".call-inbox-head", name: "통화녹음" },
  { cardId: "briefingCard", headSelector: ".briefing-head", name: "브리핑·일정" },
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

function applyDefault(defaultState) {
  const expanded = defaultState === HOME_FOLD_DEFAULT.EXPANDED;
  foldControllers.forEach((controller) => controller.setExpanded(expanded));
}

function installSettingControl() {
  const grid = document.querySelector("#settingsForm .settings-grid");
  if (!grid || document.getElementById("settingsHomeFoldDefault")) return;

  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = "메인 보조영역 기본 상태";
  const select = document.createElement("select");
  select.id = "settingsHomeFoldDefault";

  const collapsed = document.createElement("option");
  collapsed.value = HOME_FOLD_DEFAULT.COLLAPSED;
  collapsed.textContent = "기본 접기";
  const expanded = document.createElement("option");
  expanded.value = HOME_FOLD_DEFAULT.EXPANDED;
  expanded.textContent = "기본 펼치기";
  select.append(collapsed, expanded);
  select.value = loadHomeFoldDefault();
  label.append(span, select);
  grid.append(label);

  select.addEventListener("change", () => {
    const saved = saveHomeFoldDefault(select.value);
    applyDefault(saved);
    const status = document.getElementById("settingsStatus");
    if (status) {
      status.textContent = saved === HOME_FOLD_DEFAULT.EXPANDED
        ? "메인 통화·브리핑 영역을 기본 펼치기로 저장했습니다."
        : "메인 통화·브리핑 영역을 기본 접기로 저장했습니다.";
    }
  });
}

FOLD_SECTIONS.forEach(setupFoldSection);
installSettingControl();
applyDefault(loadHomeFoldDefault());
