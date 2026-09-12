import {
  isSupportedAudioFilename,
  parseCallRecordingFilename,
} from "./call-recording-parser.mjs";

const importButton = document.getElementById("callImport");
const fileInput = document.getElementById("callFiles");
const list = document.getElementById("callInboxList");
const emptyState = document.getElementById("callInboxEmpty");
const toolbar = document.getElementById("callInboxToolbar");
const countLabel = document.getElementById("callInboxCount");
const selectedOnlyButton = document.getElementById("callInboxSelectedOnly");
const clearButton = document.getElementById("callInboxClear");
const actionButton = document.getElementById("callSelectionAction");
const status = document.getElementById("callInboxStatus");
const summary = document.getElementById("callSelectionSummary");

const entries = new Map();
let nextEntryId = 1;
const durationQueue = [];
let activeDurationLoads = 0;
let showSelectedOnly = false;
const MAX_DURATION_LOADS = 2;
const FAVORITES_STORAGE_KEY = "worklog.callInbox.favoriteContacts.v1";
const favoriteContacts = loadFavoriteContacts();

function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "용량 정보 없음";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 ** 2)).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)}MB`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (minutes < 60) return `${minutes}분 ${String(remain).padStart(2, "0")}초`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}시간 ${restMinutes}분`;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupLabel(date) {
  const today = new Date();
  const dayDiff = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (dayDiff === 0) return "오늘";
  if (dayDiff === 1) return "어제";
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function timeLabel(date) {
  return date.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

function displayName(entry) {
  return entry.parsed.contact || entry.parsed.phoneDisplay || "알 수 없는 통화";
}

function contactIdentity(entry) {
  if (entry.parsed.phone) return `phone:${entry.parsed.phone}`;
  const contact = String(entry.parsed.contact || "").trim().toLocaleLowerCase("ko-KR");
  return contact ? `contact:${contact}` : "";
}

function loadFavoriteContacts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item) : []);
  } catch {
    return new Set();
  }
}

function saveFavoriteContacts() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favoriteContacts]));
  } catch {
    // 즐겨찾기는 편의 기능이므로 저장 실패가 통화 선택을 막지 않는다.
  }
}

function isFavorite(entry) {
  const identity = contactIdentity(entry);
  return Boolean(identity && favoriteContacts.has(identity));
}

function toggleFavorite(entry) {
  const identity = contactIdentity(entry);
  if (!identity) return false;
  if (favoriteContacts.has(identity)) favoriteContacts.delete(identity);
  else favoriteContacts.add(identity);
  saveFavoriteContacts();
  return favoriteContacts.has(identity);
}

function selectedEntries() {
  return [...entries.values()].filter((entry) => entry.selected);
}

function visibleEntries() {
  const all = [...entries.values()];
  return showSelectedOnly ? all.filter((entry) => entry.selected) : all;
}

function updateSelectionState() {
  const selected = selectedEntries();
  if (showSelectedOnly && selected.length === 0) showSelectedOnly = false;
  document.body.classList.toggle("call-selection-active", selected.length > 0);

  countLabel.textContent = `불러온 통화 ${entries.size}건 · 선택 ${selected.length}건`;
  actionButton.hidden = selected.length === 0;
  actionButton.disabled = selected.length === 0;
  actionButton.textContent = selected.length > 0
    ? `선택 ${selected.length}건 · 분석 준비`
    : "중요한 통화를 선택하세요";

  selectedOnlyButton.disabled = selected.length === 0;
  selectedOnlyButton.classList.toggle("active", showSelectedOnly);
  selectedOnlyButton.textContent = showSelectedOnly ? "전체 보기" : "선택한 것만 보기";
  selectedOnlyButton.setAttribute("aria-pressed", String(showSelectedOnly));
}

function createMeta(entry) {
  const meta = document.createElement("div");
  meta.className = "call-item-meta";

  const time = document.createElement("span");
  time.textContent = timeLabel(entry.parsed.recordedAt);
  meta.append(time);

  const duration = document.createElement("span");
  duration.id = `call-duration-${entry.id}`;
  duration.textContent = entry.duration ? formatDuration(entry.duration) : formatBytes(entry.file.size);
  meta.append(duration);

  if (entry.parsed.timestampSource !== "filename") {
    const fallback = document.createElement("span");
    fallback.className = "call-fallback-time";
    fallback.textContent = "파일 시간 기준";
    meta.append(fallback);
  }

  return meta;
}

function resetSelectionFeedback() {
  summary.hidden = true;
  status.textContent = "";
}

function createCallItem(entry) {
  const item = document.createElement("div");
  item.className = "call-item";
  item.classList.toggle("selected", entry.selected);
  item.classList.toggle("favorite", isFavorite(entry));

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = `call-select-${entry.id}`;
  checkbox.checked = entry.selected;
  checkbox.setAttribute("aria-label", `${displayName(entry)} 분석 대상 선택`);
  checkbox.addEventListener("change", () => {
    entry.selected = checkbox.checked;
    resetSelectionFeedback();
    render();
  });

  const body = document.createElement("label");
  body.className = "call-item-body";
  body.htmlFor = checkbox.id;

  const name = document.createElement("strong");
  name.className = "call-item-name";
  name.textContent = displayName(entry);
  body.append(name);

  if (entry.parsed.contact && entry.parsed.phoneDisplay) {
    const phone = document.createElement("span");
    phone.className = "call-item-phone";
    phone.textContent = entry.parsed.phoneDisplay;
    body.append(phone);
  }

  body.append(createMeta(entry));

  const star = document.createElement("button");
  star.type = "button";
  star.className = "call-item-star";
  const identity = contactIdentity(entry);
  const favorite = isFavorite(entry);
  star.disabled = !identity;
  star.textContent = favorite ? "★" : "☆";
  star.setAttribute("aria-pressed", String(favorite));
  star.setAttribute("aria-label", !identity
    ? `${displayName(entry)} 연락처 정보가 없어 중요 표시 불가`
    : favorite
      ? `${displayName(entry)} 중요 연락처 해제`
      : `${displayName(entry)} 중요 연락처로 표시`);
  star.title = !identity ? "연락처 정보가 없어 중요 표시 불가" : favorite ? "중요 연락처 해제" : "중요 연락처로 표시";
  star.addEventListener("click", () => {
    const enabled = toggleFavorite(entry);
    status.textContent = enabled
      ? `${displayName(entry)}을(를) 중요 연락처로 표시했습니다.`
      : `${displayName(entry)} 중요 연락처 표시를 해제했습니다.`;
    render();
  });

  item.append(checkbox, body, star);
  return item;
}

function render() {
  if (showSelectedOnly && selectedEntries().length === 0) showSelectedOnly = false;
  list.replaceChildren();
  const sorted = visibleEntries().sort(
    (a, b) => b.parsed.recordedAt.getTime() - a.parsed.recordedAt.getTime(),
  );

  const groups = new Map();
  sorted.forEach((entry) => {
    const key = dateKey(entry.parsed.recordedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });

  groups.forEach((groupEntries) => {
    const group = document.createElement("section");
    group.className = "call-date-group";

    const heading = document.createElement("h3");
    heading.className = "call-date-heading";
    heading.textContent = groupLabel(groupEntries[0].parsed.recordedAt);
    group.append(heading);

    groupEntries.forEach((entry) => group.append(createCallItem(entry)));
    list.append(group);
  });

  if (showSelectedOnly && sorted.length === 0 && entries.size > 0) {
    const message = document.createElement("div");
    message.className = "call-inbox-empty call-inbox-filter-empty";
    message.textContent = "선택된 통화가 없습니다. 전체 보기로 돌아가 통화를 선택하세요.";
    list.append(message);
  }

  const hasEntries = entries.size > 0;
  emptyState.hidden = hasEntries;
  toolbar.hidden = !hasEntries;
  updateSelectionState();
}

function loadAudioDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (value = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 7000);
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => finish(audio.duration), { once: true });
    audio.addEventListener("error", () => finish(null), { once: true });
    audio.src = objectUrl;
  });
}

function refreshSelectionSummaryIfOpen() {
  if (!summary.hidden) showSelectionSummary({ scroll: false });
}

function drainDurationQueue() {
  while (activeDurationLoads < MAX_DURATION_LOADS && durationQueue.length > 0) {
    const entry = durationQueue.shift();
    if (!entry || entry.durationLoaded) continue;
    activeDurationLoads += 1;
    entry.durationLoaded = true;
    loadAudioDuration(entry.file)
      .then((duration) => {
        if (Number.isFinite(duration) && duration > 0) entry.duration = duration;
        const target = document.getElementById(`call-duration-${entry.id}`);
        if (target) target.textContent = entry.duration ? formatDuration(entry.duration) : formatBytes(entry.file.size);
        refreshSelectionSummaryIfOpen();
      })
      .finally(() => {
        activeDurationLoads -= 1;
        drainDurationQueue();
      });
  }
}

function queueDuration(entry) {
  durationQueue.push(entry);
  drainDurationQueue();
}

function importFiles(fileList) {
  const files = [...fileList];
  let added = 0;
  let duplicate = 0;
  let unsupported = 0;

  files.forEach((file) => {
    if (!isSupportedAudioFilename(file.name) && !file.type.startsWith("audio/")) {
      unsupported += 1;
      return;
    }
    const key = fileKey(file);
    if (entries.has(key)) {
      duplicate += 1;
      return;
    }
    const fallbackDate = file.lastModified ? new Date(file.lastModified) : new Date();
    const parsed = parseCallRecordingFilename(file.name, { fallbackDate });
    const entry = {
      id: nextEntryId++,
      key,
      file,
      parsed,
      selected: false,
      duration: null,
      durationLoaded: false,
    };
    entries.set(key, entry);
    queueDuration(entry);
    added += 1;
  });

  showSelectedOnly = false;
  render();
  summary.hidden = true;
  const notes = [];
  if (added) notes.push(`${added}건을 불러왔습니다.`);
  if (duplicate) notes.push(`중복 ${duplicate}건은 제외했습니다.`);
  if (unsupported) notes.push(`오디오가 아닌 파일 ${unsupported}건은 제외했습니다.`);
  status.textContent = notes.join(" ") || "새로 추가된 통화가 없습니다.";
}

function selectedDurationSummary(selected) {
  const loaded = selected.filter((entry) => Number.isFinite(entry.duration) && entry.duration > 0);
  if (!loaded.length) return "통화 길이 확인 중";
  const seconds = loaded.reduce((total, entry) => total + entry.duration, 0);
  const formatted = formatDuration(seconds);
  return loaded.length === selected.length
    ? `총 녹음 길이 ${formatted}`
    : `확인된 녹음 길이 ${formatted} · ${selected.length - loaded.length}건 확인 중`;
}

function showSelectionSummary(options = {}) {
  const selected = selectedEntries();
  if (!selected.length) return;
  summary.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = `분석 준비 ${selected.length}건`;
  summary.append(title);

  const duration = document.createElement("p");
  duration.className = "call-selection-duration";
  duration.textContent = selectedDurationSummary(selected);
  summary.append(duration);

  const names = document.createElement("ul");
  names.className = "call-selection-list";
  selected.slice(0, 8).forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${displayName(entry)} · ${groupLabel(entry.parsed.recordedAt)} ${timeLabel(entry.parsed.recordedAt)}${entry.duration ? ` · ${formatDuration(entry.duration)}` : ""}`;
    names.append(item);
  });
  if (selected.length > 8) {
    const more = document.createElement("li");
    more.textContent = `외 ${selected.length - 8}건`;
    names.append(more);
  }
  summary.append(names);

  const note = document.createElement("p");
  note.textContent = "현재 V1.1에서는 선택 확인까지만 로컬에서 처리합니다. STT 연결 전이라 녹음파일은 서버로 전송되지 않습니다.";
  summary.append(note);
  summary.hidden = false;
  status.textContent = `선택 ${selected.length}건이 분석 준비 상태입니다.`;
  if (options.scroll !== false) summary.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

importButton?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", () => {
  if (fileInput.files?.length) importFiles(fileInput.files);
  fileInput.value = "";
});
selectedOnlyButton?.addEventListener("click", () => {
  if (!selectedEntries().length) return;
  showSelectedOnly = !showSelectedOnly;
  render();
});
clearButton?.addEventListener("click", () => {
  if (!entries.size) return;
  const confirmed = window.confirm("불러온 통화 목록을 비울까요? 휴대폰의 원본 녹음파일은 삭제되지 않습니다.");
  if (!confirmed) return;
  entries.clear();
  durationQueue.length = 0;
  showSelectedOnly = false;
  summary.hidden = true;
  status.textContent = "통화 목록을 비웠습니다. 원본 녹음파일은 삭제되지 않습니다.";
  render();
});
actionButton?.addEventListener("click", () => showSelectionSummary());

render();
