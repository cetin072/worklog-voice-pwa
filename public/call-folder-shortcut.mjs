import { selectRecentAudioFiles } from "./call-folder-utils.mjs";

const DB_NAME = "worklog-local-handles-v1";
const STORE_NAME = "handles";
const HANDLE_KEY = "call-recordings";
const PICKER_ID = "worklog-call-recordings";
const MAX_FOLDER_FILES = 150;

const importButton = document.getElementById("callImport");
const fileInput = document.getElementById("callFiles");
let currentHandle = null;

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

async function ensureReadPermission(handle) {
  if (!handle) return false;
  try {
    if (typeof handle.queryPermission === "function") {
      const current = await handle.queryPermission({ mode: "read" });
      if (current === "granted") return true;
    }
    if (typeof handle.requestPermission === "function") {
      return (await handle.requestPermission({ mode: "read" })) === "granted";
    }
    return true;
  } catch {
    return false;
  }
}

async function readFolderFiles(handle) {
  const files = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file") continue;
    try { files.push(await entry.getFile()); } catch {}
  }
  return selectRecentAudioFiles(files, MAX_FOLDER_FILES);
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
  const primary = document.createElement("button");
  primary.type = "button";
  primary.className = "call-folder-primary";
  const actions = document.createElement("div");
  actions.className = "call-folder-actions";
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
  wrap.append(primary, actions, note, status);
  importButton.insertAdjacentElement("afterend", wrap);
  return { primary, actions, change, forget, note, status };
}

const ui = buildUi();

function setStatus(message, error = false) {
  if (!ui) return;
  ui.status.textContent = message;
  ui.status.classList.toggle("error", error);
}

function updateUi(hasHandle) {
  if (!ui) return;
  ui.primary.textContent = hasHandle ? "📁 연결된 녹음 폴더에서 불러오기" : "📁 녹음 폴더 연결하기";
  ui.actions.hidden = !hasHandle;
  ui.note.textContent = hasHandle
    ? `연결된 폴더의 최근 오디오 최대 ${MAX_FOLDER_FILES}개를 이 기기에서만 읽습니다.`
    : "폴더 연결 화면에서는 파일이 보이지 않는 것이 정상입니다. TPhoneCallRecords에서 ‘이 폴더 사용’을 누르면 됩니다.";
}

async function loadFromHandle(handle) {
  if (!(await ensureReadPermission(handle))) {
    setStatus("폴더 읽기 권한이 필요합니다. 다시 연결하거나 기존 가져오기를 사용하세요.", true);
    return;
  }
  setStatus("연결된 폴더에서 녹음파일을 확인 중입니다…");
  try {
    const files = await readFolderFiles(handle);
    if (!files.length) return setStatus("이 폴더에서 지원되는 통화녹음 파일을 찾지 못했습니다.", true);
    if (!handoffFiles(files)) return setStatus("이 브라우저에서는 폴더 파일을 목록으로 전달할 수 없습니다. 기존 가져오기를 사용하세요.", true);
    setStatus(`${files.length}건을 연결된 폴더에서 불러왔습니다. 서버로 전송하지 않았습니다.`);
  } catch {
    setStatus("연결된 폴더를 읽지 못했습니다. 폴더를 다시 연결해 주세요.", true);
  }
}

async function chooseFolderAndLoad() {
  if (typeof window.showDirectoryPicker !== "function") return;
  try {
    setStatus("TPhoneCallRecords까지 들어간 뒤 ‘이 폴더 사용’을 누르세요. 파일이 안 보이는 것이 정상입니다.");
    const handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: "read" });
    await saveHandle(handle);
    currentHandle = handle;
    updateUi(true);
    await loadFromHandle(handle);
  } catch (error) {
    if (error?.name === "AbortError") setStatus("폴더 선택을 취소했습니다.");
    else setStatus("폴더 연결에 실패했습니다. 기존 가져오기 방식은 계속 사용할 수 있습니다.", true);
  }
}

async function initialize() {
  if (!ui) return;
  if (typeof window.showDirectoryPicker !== "function" || !("indexedDB" in window)) {
    updateUi(false);
    ui.primary.disabled = true;
    ui.primary.textContent = "📁 폴더 바로가기 미지원";
    ui.note.textContent = "현재 브라우저에서는 폴더 기억 기능을 지원하지 않습니다. 기존 ‘통화녹음 가져오기’를 사용하세요.";
    return;
  }
  try { currentHandle = await loadHandle(); } catch { currentHandle = null; }
  updateUi(Boolean(currentHandle));
  ui.primary.addEventListener("click", () => currentHandle ? loadFromHandle(currentHandle) : chooseFolderAndLoad());
  ui.change.addEventListener("click", chooseFolderAndLoad);
  ui.forget.addEventListener("click", async () => {
    await removeHandle();
    currentHandle = null;
    updateUi(false);
    setStatus("연결된 녹음 폴더를 해제했습니다.");
  });
}

initialize();
