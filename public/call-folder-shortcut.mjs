import {
  DEFAULT_FOLDER_LIMIT,
  ensureReadPermission,
  readFolderFiles,
} from "./call-folder-runtime.mjs";

const DB_NAME = "worklog-local-handles-v1";
const STORE_NAME = "handles";
const HANDLE_KEY = "call-recordings";
const PICKER_ID = "worklog-call-recordings";
const EXPECTED_FOLDER_NAME = "TPhoneCallRecords";
const MAX_FOLDER_FILES = DEFAULT_FOLDER_LIMIT;

const importButton = document.getElementById("callImport");
const fileInput = document.getElementById("callFiles");
let currentHandle = null;
let loading = false;

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

function handoffFiles(files) {
  if (!fileInput || !files.length || typeof DataTransfer === "undefined") return false;
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
  const wrap = document.createElement("div");
  wrap.id = "callFolderShortcut";
  wrap.className = "call-folder-shortcut";

  const connection = document.createElement("div");
  connection.className = "call-folder-connection";
  connection.hidden = true;

  const badge = document.createElement("span");
  badge.className = "call-folder-connected-badge";
  badge.textContent = "✓ 연결됨";

  const folderName = document.createElement("strong");
  folderName.className = "call-folder-connected-name";
  connection.append(badge, folderName);

  const primary = document.createElement("button");
  primary.type = "button";
  primary.className = "call-folder-primary";

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

  wrap.append(connection, primary, actions, note, status);
  importButton.insertAdjacentElement("afterend", wrap);
  return { connection, folderName, primary, actions, change, forget, note, status };
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
  ui.primary.disabled = busy;
  ui.change.disabled = busy;
  ui.forget.disabled = busy;
  ui.primary.classList.toggle("loading", busy);
}

function updateUi(handle = null) {
  if (!ui) return;
  const hasHandle = Boolean(handle);
  ui.connection.hidden = !hasHandle;
  ui.actions.hidden = !hasHandle;
  ui.folderName.textContent = hasHandle ? (handle.name || "연결된 녹음 폴더") : "";
  ui.primary.textContent = hasHandle ? "최근 녹음 불러오기" : "📁 녹음 폴더 연결하기";
  ui.note.textContent = hasHandle
    ? `이 폴더의 최근 오디오 최대 ${MAX_FOLDER_FILES}개를 이 기기에서만 읽습니다. 원본 파일은 이동하거나 삭제하지 않습니다.`
    : "폴더 연결 화면에서는 파일이 보이지 않는 것이 정상입니다. TPhoneCallRecords에서 ‘이 폴더 사용’ → ‘허용’을 누르면 됩니다.";
}

function folderNameNote(handle) {
  const name = String(handle?.name || "");
  if (!name) return "폴더명이 확인되지 않았습니다.";
  if (name === EXPECTED_FOLDER_NAME) return `폴더명 ${EXPECTED_FOLDER_NAME} 확인됨`;
  return `연결 폴더명: ${name} · 이 기기에서 실제 녹음 폴더가 맞는지 확인 필요`;
}

function pickerInstruction() {
  const edgeAndroid = /\bEdgA\//i.test(navigator.userAgent || "");
  if (edgeAndroid) {
    return "TPhoneCallRecords에서 ‘이 폴더 사용’ → ‘허용’까지 누르세요. 허용 뒤에도 폴더 화면이 남으면 뒤로가기를 누르지 말고 홈으로 나갔다가 업무수첩으로 돌아오세요.";
  }
  return "TPhoneCallRecords까지 들어간 뒤 ‘이 폴더 사용’ → ‘허용’을 누르세요. 파일이 안 보이는 것이 정상입니다.";
}

async function loadFromHandle(handle) {
  if (loading) return false;
  if (!(await ensureReadPermission(handle))) {
    setStatus("폴더 읽기 권한이 없습니다. ‘폴더 변경’으로 다시 연결하거나 기존 가져오기를 사용하세요.", true);
    return false;
  }

  setBusy(true);
  setStatus(`✓ ${folderNameNote(handle)} · 파일 이름을 빠르게 확인 중입니다…`);

  try {
    const result = await readFolderFiles(handle, (scan) => {
      if (!scan.totalAudioCount) {
        setStatus(`✓ ${folderNameNote(handle)} · 파일 ${scan.scannedCount}개를 확인했지만 지원되는 오디오를 찾지 못했습니다.`, true);
        return;
      }
      const targetCount = Math.min(scan.totalAudioCount, MAX_FOLDER_FILES);
      setStatus(`✓ ${folderNameNote(handle)} · 오디오 ${scan.totalAudioCount}건 발견 · 최근 ${targetCount}건만 여는 중입니다…`);
    });

    if (!result.totalAudioCount) {
      setStatus(`✓ 폴더 연결은 됐지만 오디오 파일이 0건입니다. ${folderNameNote(handle)}.`, true);
      return false;
    }
    if (!result.files.length) {
      setStatus(`✓ 오디오 ${result.totalAudioCount}건은 찾았지만 Edge가 파일을 열지 못했습니다. 기존 ‘통화녹음 가져오기’를 사용하거나 다시 시도해 주세요.`, true);
      return false;
    }
    if (!handoffFiles(result.files)) {
      setStatus(`✓ 오디오 ${result.totalAudioCount}건은 찾았지만 이 브라우저가 앱 목록으로 전달하지 못했습니다. 기존 ‘통화녹음 가져오기’를 사용하세요.`, true);
      return false;
    }

    const skipped = result.failedCount ? ` · 열기 실패 ${result.failedCount}건` : "";
    const newest = result.newestName ? ` · 최신 ${result.newestName}` : "";
    setStatus(`✓ ${handle.name || "녹음 폴더"} · 오디오 ${result.totalAudioCount}건 확인 · 최근 ${result.files.length}건 불러옴${skipped}${newest}`);
    return true;
  } catch (error) {
    if (error?.code === "FOLDER_SCAN_TIMEOUT") {
      setStatus("✓ 폴더 연결은 유지됐지만 목록 확인이 20초를 넘어 중단했습니다. 녹음이 아주 많거나 Edge 폴더 읽기가 지연된 상태입니다. 다시 시도하거나 기존 가져오기를 사용하세요.", true);
    } else if (error?.code === "DIRECTORY_ITERATOR_UNSUPPORTED") {
      setStatus("✓ 폴더 연결은 됐지만 이 Edge 버전은 폴더 내부 목록 읽기를 지원하지 않습니다. 기존 ‘통화녹음 가져오기’를 사용하세요.", true);
    } else {
      setStatus(`✓ 폴더 연결은 유지됐지만 파일 목록을 읽지 못했습니다${error?.message ? ` · ${error.message}` : ""}.`, true);
    }
    return false;
  } finally {
    setBusy(false);
  }
}

async function chooseFolderAndLoad() {
  if (typeof window.showDirectoryPicker !== "function" || loading) return;
  try {
    setStatus(pickerInstruction());
    const handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: "read" });
    await saveHandle(handle);
    currentHandle = handle;
    updateUi(currentHandle);
    setStatus(`✓ ${folderNameNote(handle)} · 연결 정보를 이 기기에 저장했습니다.`);
    try { window.focus?.(); } catch {}
    await loadFromHandle(handle);
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus(currentHandle
        ? `기존 ${currentHandle.name || "녹음 폴더"} 연결은 유지됩니다. 새 폴더 선택만 취소했습니다.`
        : "폴더가 연결되지 않았습니다. TPhoneCallRecords에서 ‘이 폴더 사용’ → ‘허용’까지 눌러야 연결됩니다.", !currentHandle);
    } else {
      setStatus("폴더 연결에 실패했습니다. 기존 가져오기 방식은 계속 사용할 수 있습니다.", true);
    }
  }
}

async function initialize() {
  if (!ui) return;
  if (typeof window.showDirectoryPicker !== "function" || !("indexedDB" in window)) {
    updateUi(null);
    ui.primary.disabled = true;
    ui.primary.hidden = true;
    ui.note.textContent = "현재 브라우저에서는 폴더 기억 기능을 지원하지 않습니다. 기존 ‘통화녹음 가져오기’를 사용하세요.";
    return;
  }

  try { currentHandle = await loadHandle(); } catch { currentHandle = null; }
  updateUi(currentHandle);
  if (currentHandle) setStatus(`✓ ${folderNameNote(currentHandle)} · 연결 정보가 저장되어 있습니다.`);

  ui.primary.addEventListener("click", () => currentHandle ? loadFromHandle(currentHandle) : chooseFolderAndLoad());
  ui.change.addEventListener("click", chooseFolderAndLoad);
  ui.forget.addEventListener("click", async () => {
    await removeHandle();
    currentHandle = null;
    updateUi(null);
    setStatus("녹음 폴더 연결을 해제했습니다. 휴대폰 원본 파일은 그대로입니다.");
  });
}

initialize();
