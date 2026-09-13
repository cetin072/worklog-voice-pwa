import {
  dateInputRange,
  recentCalendarRange,
  selectAudioFilesInRange,
} from "./call-folder-utils.mjs";
import {
  ensureReadPermission,
  readFolderFiles,
} from "./call-folder-runtime.mjs";

const DB_NAME = "worklog-local-handles-v1";
const STORE_NAME = "handles";
const HANDLE_KEY = "call-recordings";
const DIRECTORY_PICKER_ID = "worklog-call-recordings-folder";
const FILE_PICKER_ID = "worklog-call-recording-files";
const EXPECTED_FOLDER_NAME = "TPhoneCallRecords";
const DEFAULT_RECENT_DAYS = 3;
const DIRECTORY_BLOCKED_KEY = "worklog.callFolder.directoryReadBlocked.v1";

const importButton = document.getElementById("callImport");
const fileInput = document.getElementById("callFiles");
let currentHandle = null;
let loading = false;
let filePickerMode = false;

function isEdgeAndroid() {
  return /\bEdgA\//i.test(navigator.userAgent || "");
}

function directoryReadBlocked() {
  try { return localStorage.getItem(DIRECTORY_BLOCKED_KEY) === "1"; } catch { return false; }
}

function setDirectoryReadBlocked(blocked) {
  try {
    if (blocked) localStorage.setItem(DIRECTORY_BLOCKED_KEY, "1");
    else localStorage.removeItem(DIRECTORY_BLOCKED_KEY);
  } catch {
    // 편의 플래그 저장 실패는 가져오기 자체를 막지 않는다.
  }
}

function shouldUseFilePickerMode() {
  return isEdgeAndroid() || directoryReadBlocked() || typeof window.showDirectoryPicker !== "function";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandle(handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadHandle() {
  const db = await openDb();
  const handle = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

async function removeHandle() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function handoffFiles(files, source = "folder") {
  if (!files.length) return false;
  try {
    const detail = { files: [...files], accepted: false, source };
    window.dispatchEvent(new CustomEvent("worklog:call-files-import", { detail }));
    if (detail.accepted) return true;
  } catch {
    // 구형 환경은 아래 file input fallback을 시도한다.
  }

  if (!fileInput || typeof DataTransfer === "undefined") return false;
  try {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

function buildUi() {
  if (!importButton || document.getElementById("callFolderShortcut")) return null;
  importButton.textContent = "파일 직접 선택";

  const wrap = document.createElement("div");
  wrap.id = "callFolderShortcut";
  wrap.className = "call-folder-shortcut";

  const connection = document.createElement("div");
  connection.className = "call-folder-connection";
  connection.hidden = true;
  const badge = document.createElement("span");
  badge.className = "call-folder-connected-badge";
  const folderName = document.createElement("strong");
  folderName.className = "call-folder-connected-name";
  connection.append(badge, folderName);

  const primary = document.createElement("button");
  primary.type = "button";
  primary.className = "call-folder-primary";

  const range = document.createElement("div");
  range.className = "call-folder-range";
  range.hidden = true;
  const rangeTitle = document.createElement("strong");
  rangeTitle.className = "call-folder-range-title";
  rangeTitle.textContent = "이전 통화 기간 선택";
  const fields = document.createElement("div");
  fields.className = "call-folder-range-fields";

  const startLabel = document.createElement("label");
  startLabel.innerHTML = "<span>시작일</span>";
  const startInput = document.createElement("input");
  startInput.type = "date";
  startInput.className = "call-folder-date";
  startLabel.append(startInput);

  const endLabel = document.createElement("label");
  endLabel.innerHTML = "<span>종료일</span>";
  const endInput = document.createElement("input");
  endInput.type = "date";
  endInput.className = "call-folder-date";
  endLabel.append(endInput);
  fields.append(startLabel, endLabel);

  const rangeLoad = document.createElement("button");
  rangeLoad.type = "button";
  rangeLoad.className = "call-folder-range-load";
  rangeLoad.textContent = "선택 기간 불러오기";
  range.append(rangeTitle, fields, rangeLoad);

  const actions = document.createElement("div");
  actions.className = "call-folder-actions";
  actions.hidden = true;
  const change = document.createElement("button");
  change.type = "button";
  change.textContent = "폴더 변경";
  const forget = document.createElement("button");
  forget.type = "button";
  forget.textContent = "연결 해제";
  actions.append(change, forget);

  const note = document.createElement("p");
  note.className = "call-folder-note";
  const status = document.createElement("p");
  status.className = "call-folder-status";
  status.setAttribute("aria-live", "polite");

  wrap.append(connection, primary, range, actions, note, status);
  importButton.insertAdjacentElement("beforebegin", wrap);
  return { connection, badge, folderName, primary, range, startInput, endInput, rangeLoad, actions, change, forget, note, status };
}

const ui = buildUi();

function setStatus(message, error = false) {
  if (!ui) return;
  ui.status.textContent = message;
  ui.status.classList.toggle("error", error);
}

function setBusy(busy) {
  loading = busy;
  if (!ui) return;
  for (const target of [ui.primary, ui.rangeLoad, ui.startInput, ui.endInput, ui.change, ui.forget]) target.disabled = busy;
  ui.primary.classList.toggle("loading", busy);
}

function folderNameNote(handle) {
  const name = String(handle?.name || "");
  if (!name) return "폴더명이 확인되지 않았습니다.";
  if (name === EXPECTED_FOLDER_NAME) return `폴더명 ${EXPECTED_FOLDER_NAME} 확인됨`;
  return `연결 폴더명: ${name}`;
}

function updateUi() {
  if (!ui) return;
  filePickerMode = shouldUseFilePickerMode();
  ui.range.hidden = false;

  if (filePickerMode) {
    ui.connection.hidden = false;
    ui.badge.textContent = "빠른 선택";
    ui.folderName.textContent = currentHandle?.name || "최근 위치 기억";
    ui.actions.hidden = true;
    ui.primary.textContent = `최근 ${DEFAULT_RECENT_DAYS}일 파일 선택`;
    ui.note.textContent = `이 기기에서는 폴더 자동 읽기 대신 파일 선택기를 사용합니다. 브라우저가 같은 선택기 ID의 마지막 위치를 기억할 수 있으며, 여러 파일을 고르면 앱이 최근 ${DEFAULT_RECENT_DAYS}일 또는 선택 기간만 남깁니다.`;
    return;
  }

  const hasHandle = Boolean(currentHandle);
  ui.connection.hidden = !hasHandle;
  ui.badge.textContent = "✓ 연결됨";
  ui.folderName.textContent = hasHandle ? (currentHandle.name || "연결된 녹음 폴더") : "";
  ui.actions.hidden = !hasHandle;
  ui.primary.textContent = hasHandle ? `최근 ${DEFAULT_RECENT_DAYS}일 통화 불러오기` : "📁 녹음 폴더 연결하기";
  ui.note.textContent = hasHandle
    ? `기본은 오늘을 포함한 최근 ${DEFAULT_RECENT_DAYS}일 통화만 읽습니다. 더 이전 통화는 기간을 선택하세요.`
    : "지원되는 브라우저에서는 녹음 폴더를 한 번 연결해 자동으로 읽을 수 있습니다.";
}

function rangeNote(result) {
  const notes = [];
  if (result.undatedCount) notes.push(`날짜 확인 불가 ${result.undatedCount}건 제외`);
  if (result.fallbackDateCount) notes.push(`파일 수정일 기준 ${result.fallbackDateCount}건`);
  return notes.length ? ` · ${notes.join(" · ")}` : "";
}

function filePickerOptions() {
  const options = {
    id: FILE_PICKER_ID,
    multiple: true,
    types: [{
      description: "통화녹음 오디오",
      accept: { "audio/*": [".m4a", ".mp3", ".wav", ".aac", ".3gp", ".mp4", ".ogg", ".opus"] },
    }],
  };
  if (currentHandle) options.startIn = currentHandle;
  return options;
}

async function pickFilesForRange(range, label) {
  if (loading) return false;
  if (typeof window.showOpenFilePicker !== "function") {
    setStatus("이 브라우저는 위치 기억형 파일 선택기를 지원하지 않습니다. 아래 ‘파일 직접 선택’을 사용하세요.", true);
    fileInput?.click();
    return false;
  }

  setBusy(true);
  setStatus(`${label} 통화파일을 선택하세요. 같은 선택기를 다시 열면 마지막 위치를 기억할 수 있습니다.`);
  try {
    const handles = await window.showOpenFilePicker(filePickerOptions());
    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    const selected = selectAudioFilesInRange(files, range);
    if (!selected.totalAudioCount) {
      setStatus("선택한 항목에서 오디오 파일을 찾지 못했습니다.", true);
      return false;
    }
    if (!selected.matchedCount) {
      setStatus(`${selected.totalAudioCount}개 오디오를 선택했지만 ${label}에 해당하는 파일은 없습니다${rangeNote(selected)}.`, true);
      return false;
    }
    if (!handoffFiles(selected.files, "file-picker")) {
      setStatus(`${selected.matchedCount}건을 읽었지만 통화 목록으로 전달하지 못했습니다.`, true);
      return false;
    }
    setStatus(`✓ ${label} ${selected.matchedCount}건 불러옴${rangeNote(selected)}${selected.newestName ? ` · 최신 ${selected.newestName}` : ""}`);
    return true;
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("파일 선택을 취소했습니다. 기존 통화 목록은 그대로 유지됩니다.");
    } else {
      setStatus(`파일 선택기를 열지 못했습니다${error?.message ? ` · ${error.message}` : ""}. 아래 ‘파일 직접 선택’을 사용할 수 있습니다.`, true);
    }
    return false;
  } finally {
    setBusy(false);
  }
}

async function loadFromHandle(handle, range, label) {
  if (loading) return false;
  if (!(await ensureReadPermission(handle))) {
    setDirectoryReadBlocked(true);
    updateUi();
    return pickFilesForRange(range, label);
  }

  setBusy(true);
  setStatus(`✓ ${folderNameNote(handle)} · ${label} 파일명을 확인 중입니다…`);
  try {
    const result = await readFolderFiles(handle, (scan) => {
      if (!scan.totalAudioCount) return;
      if (!scan.matchedCount) return;
      setStatus(`✓ 오디오 ${scan.totalAudioCount}건 확인 · ${label} ${scan.matchedCount}건만 여는 중입니다${rangeNote(scan)}…`);
    }, { startMs: range.startMs, endMs: range.endMs });

    if (!result.totalAudioCount) {
      setDirectoryReadBlocked(true);
      updateUi();
      setStatus("이 폴더는 일반 파일선택에서는 녹음이 보이지만 폴더 자동읽기에서는 내부 파일이 노출되지 않습니다. 파일 선택 모드로 전환했습니다.", true);
      return false;
    }
    if (!result.matchedCount) {
      setStatus(`✓ ${label}에 해당하는 통화가 없습니다. 폴더 전체 오디오는 ${result.totalAudioCount}건입니다${rangeNote(result)}.`);
      return true;
    }
    if (!result.files.length || !handoffFiles(result.files, "folder")) {
      setDirectoryReadBlocked(true);
      updateUi();
      setStatus("폴더에서는 통화를 찾았지만 브라우저가 파일을 앱에 전달하지 못해 파일 선택 모드로 전환했습니다.", true);
      return false;
    }

    setStatus(`✓ ${handle.name || "녹음 폴더"} · ${label} ${result.files.length}건 불러옴${rangeNote(result)}${result.newestName ? ` · 최신 ${result.newestName}` : ""}`);
    return true;
  } catch (error) {
    if (["FOLDER_SCAN_TIMEOUT", "DIRECTORY_ITERATOR_UNSUPPORTED"].includes(error?.code)) {
      setDirectoryReadBlocked(true);
      updateUi();
      setStatus("이 기기에서는 녹음 폴더 자동읽기가 안정적으로 동작하지 않아 파일 선택 모드로 전환했습니다. 폴더 연결은 다시 할 필요가 없습니다.", true);
    } else {
      setStatus(`폴더 목록을 읽지 못했습니다${error?.message ? ` · ${error.message}` : ""}.`, true);
    }
    return false;
  } finally {
    setBusy(false);
  }
}

function recentRange() {
  return recentCalendarRange(DEFAULT_RECENT_DAYS, new Date());
}

function selectedRange() {
  return dateInputRange(ui?.startInput.value, ui?.endInput.value);
}

async function loadRecent() {
  const range = recentRange();
  if (!range) return false;
  const label = `최근 ${DEFAULT_RECENT_DAYS}일`;
  return filePickerMode ? pickFilesForRange(range, label) : (currentHandle ? loadFromHandle(currentHandle, range, label) : chooseFolderAndLoad());
}

async function loadSelectedRange() {
  const range = selectedRange();
  if (!range) {
    setStatus("시작일과 종료일을 올바르게 선택하세요. 시작일은 종료일보다 늦을 수 없습니다.", true);
    return false;
  }
  const label = `${ui.startInput.value} ~ ${ui.endInput.value}`;
  return filePickerMode ? pickFilesForRange(range, label) : (currentHandle ? loadFromHandle(currentHandle, range, label) : false);
}

async function chooseFolderAndLoad() {
  if (typeof window.showDirectoryPicker !== "function" || loading) return false;
  try {
    const handle = await window.showDirectoryPicker({ id: DIRECTORY_PICKER_ID, mode: "read" });
    await saveHandle(handle);
    currentHandle = handle;
    setDirectoryReadBlocked(false);
    updateUi();
    return loadRecent();
  } catch (error) {
    if (error?.name === "AbortError") setStatus("폴더 선택을 취소했습니다. 기존 연결은 유지됩니다.");
    else setStatus("폴더 연결에 실패했습니다. 파일 선택 모드는 계속 사용할 수 있습니다.", true);
    return false;
  }
}

async function initialize() {
  if (!ui) return;
  if ("indexedDB" in window) {
    try { currentHandle = await loadHandle(); } catch { currentHandle = null; }
  }
  updateUi();
  if (filePickerMode) {
    setStatus(isEdgeAndroid()
      ? "Edge Android에서는 폴더 자동읽기 대신 마지막 위치를 기억하는 파일 선택 모드를 사용합니다."
      : "이 브라우저에서는 파일 선택 모드를 사용합니다.");
  } else if (currentHandle) {
    setStatus(`✓ ${folderNameNote(currentHandle)} · 연결 정보가 저장되어 있습니다.`);
  }

  ui.primary.addEventListener("click", loadRecent);
  ui.rangeLoad.addEventListener("click", loadSelectedRange);
  ui.change.addEventListener("click", chooseFolderAndLoad);
  ui.forget.addEventListener("click", async () => {
    await removeHandle();
    currentHandle = null;
    setDirectoryReadBlocked(false);
    updateUi();
    setStatus("녹음 폴더 연결 정보를 지웠습니다. 휴대폰 원본 파일은 그대로입니다.");
  });
}

initialize();
