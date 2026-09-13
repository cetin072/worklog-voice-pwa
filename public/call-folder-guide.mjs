export const CALL_RECORDING_PATH_GUIDE = Object.freeze({
  label: "내장 저장공간 → Recordings → TPhoneCallRecords",
  clipboard: "내장 저장공간/Recordings/TPhoneCallRecords",
});

const importButton = document.getElementById("callImport");

function isEdgeAndroid() {
  return /\bEdgA\//i.test(navigator.userAgent || "");
}

function copyFallback(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand?.("copy");
  area.remove();
  return Boolean(copied);
}

async function copyPath(button) {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(CALL_RECORDING_PATH_GUIDE.clipboard);
      copied = true;
    } else {
      copied = copyFallback(CALL_RECORDING_PATH_GUIDE.clipboard);
    }
  } catch {
    copied = copyFallback(CALL_RECORDING_PATH_GUIDE.clipboard);
  }
  const original = "경로 복사";
  button.textContent = copied ? "복사됨 ✓" : "복사 실패";
  setTimeout(() => { button.textContent = original; }, 1600);
}

function buildGuide() {
  if (!importButton || document.getElementById("callFolderPathGuide")) return;
  const guide = document.createElement("div");
  guide.id = "callFolderPathGuide";
  guide.className = "call-folder-path-guide";

  const top = document.createElement("div");
  top.className = "call-folder-path-top";
  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "📍 통화녹음 위치";
  const path = document.createElement("p");
  path.className = "call-folder-path";
  path.textContent = CALL_RECORDING_PATH_GUIDE.label;
  text.append(title, path);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "call-folder-copy";
  copy.textContent = "경로 복사";
  copy.addEventListener("click", () => copyPath(copy));
  top.append(text, copy);

  const steps = document.createElement("p");
  steps.className = "call-folder-path-help";
  steps.textContent = isEdgeAndroid()
    ? "Edge Android에서는 폴더 자동읽기 대신 검증된 파일 선택 방식을 사용합니다. 파일 선택창에서 ‘오디오’를 누르고 필요한 통화녹음을 여러 개 고르세요. 위 경로는 찾을 때 참고용입니다."
    : "폴더 자동읽기를 지원하는 브라우저에서는 최근 3일 통화를 자동으로 추릴 수 있습니다. 지원하지 않으면 파일 선택 방식으로 전환합니다.";

  const note = document.createElement("p");
  note.className = "call-folder-path-note";
  note.textContent = "현재 확인된 에이닷 전화 녹음 경로입니다. 휴대폰·전화앱 버전에 따라 위치가 다를 수 있습니다.";

  guide.append(top, steps, note);
  importButton.insertAdjacentElement("beforebegin", guide);
}

function applyEdgeDirectSelectionUx() {
  if (!isEdgeAndroid() || !importButton) return;
  const shortcut = document.getElementById("callFolderShortcut");
  if (shortcut) {
    shortcut.hidden = true;
    shortcut.setAttribute("aria-hidden", "true");
  }
  importButton.hidden = false;
  importButton.textContent = "통화녹음 파일 선택";
  importButton.setAttribute("aria-label", "통화녹음 오디오 파일 여러 개 선택");
}

function hideUnsupportedShortcut() {
  const shortcut = document.getElementById("callFolderShortcut");
  if (!shortcut || isEdgeAndroid()) return;
  const primary = shortcut.querySelector(".call-folder-primary");
  if (primary?.disabled && !shortcut.querySelector(".call-folder-connection:not([hidden])")) {
    primary.hidden = true;
    shortcut.classList.add("is-fallback-only");
  }
}

buildGuide();
setTimeout(applyEdgeDirectSelectionUx, 0);
setTimeout(applyEdgeDirectSelectionUx, 300);
setTimeout(hideUnsupportedShortcut, 0);
setTimeout(hideUnsupportedShortcut, 300);
