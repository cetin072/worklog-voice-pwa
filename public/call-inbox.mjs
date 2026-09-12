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
const clearButton = document.getElementById("callInboxClear");
const actionButton = document.getElementById("callSelectionAction");
const status = document.getElementById("callInboxStatus");
const summary = document.getElementById("callSelectionSummary");

const entries = new Map();
let nextEntryId = 1;
const durationQueue = [];
let activeDurationLoads = 0;
const MAX_DURATION_LOADS = 2;

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

function selectedEntries() {
  return [...entries.values()].filter((entry) => entry.selected);
}

function updateSelectionState() {
  const selected = selectedEntries();
  countLabel.textContent = `불러온 통화 ${entries.size}건 · 선택 ${selected.length}건`;
  actionButton.hidden = entries.size === 0;
  actionButton.disabled = selected.length === 0;
  actionButton.textContent = selected.length > 0
    ? `선택한 통화 ${selected.length}건 확인`
    : "중요한 통화를 선택하세요";
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

function createCallItem(entry) {
  const label = document.createElement("label");
  label.className = "call-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = entry.selected;
  checkbox.setAttribute("aria-label", `${displayName(entry)} 분석 대상 선택`);
  checkbox.addEventListener("change", () => {
    entry.selected = checkbox.checked;
    label.classList.toggle("selected", entry.selected);
    summary.hidden = true;
    status.textContent = "";
    updateSelectionState();
  });

  const body = document.createElement("div");
  body.className = "call-item-body";

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

  const star = document.createElement("span");
  star.className = "call-item-star";
  star.textContent = "★";
  star.setAttribute("aria-hidden", "true");

  label.classList.toggle("selected", entry.selected);
  label.append(checkbox, body, star);
  return label;
}

function render() {
  list.replaceChildren();
  const sorted = [...entries.values()].sort(
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

  render();
  summary.hidden = true;
  const notes = [];
  if (added) notes.push(`${added}건을 불러왔습니다.`);
  if (duplicate) notes.push(`중복 ${duplicate}건은 제외했습니다.`);
  if (unsupported) notes.push(`오디오가 아닌 파일 ${unsupported}건은 제외했습니다.`);
  status.textContent = notes.join(" ") || "새로 추가된 통화가 없습니다.";
}

function showSelectionSummary() {
  const selected = selectedEntries();
  if (!selected.length) return;
  summary.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = `분석 대상으로 ${selected.length}건 선택`;
  summary.append(title);

  const names = document.createElement("ul");
  names.className = "call-selection-list";
  selected.slice(0, 5).forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${displayName(entry)} · ${timeLabel(entry.parsed.recordedAt)}`;
    names.append(item);
  });
  if (selected.length > 5) {
    const more = document.createElement("li");
    more.textContent = `외 ${selected.length - 5}건`;
    names.append(more);
  }
  summary.append(names);

  const note = document.createElement("p");
  note.textContent = "현재 V1에서는 여기까지 로컬에서만 처리합니다. STT 연결 전이라 녹음파일은 서버로 전송되지 않습니다.";
  summary.append(note);
  summary.hidden = false;
  status.textContent = "선택 결과를 확인했습니다. 다음 단계에서 이 파일들만 STT 분석하도록 연결합니다.";
  summary.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

importButton?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", () => {
  if (fileInput.files?.length) importFiles(fileInput.files);
  fileInput.value = "";
});
clearButton?.addEventListener("click", () => {
  entries.clear();
  durationQueue.length = 0;
  summary.hidden = true;
  status.textContent = "통화 목록을 비웠습니다. 원본 녹음파일은 삭제되지 않습니다.";
  render();
});
actionButton?.addEventListener("click", showSelectionSummary);

render();
