export const CALL_RECORDING_PATH_GUIDE = Object.freeze({
  label: "내장 저장공간 → Recordings → TPhoneCallRecords",
  clipboard: "내장 저장공간/Recordings/TPhoneCallRecords",
});

const importButton = document.getElementById("callImport");

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
  title.textContent = "📍 통화녹음 폴더";
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
  steps.textContent = "폴더 연결에서는 파일이 안 보이는 것이 정상입니다. TPhoneCallRecords까지 들어간 뒤 ‘이 폴더 사용’ → ‘허용’을 누르세요.";

  const edgeNote = document.createElement("p");
  edgeNote.className = "call-folder-path-help";
  edgeNote.textContent = "Edge에서 ‘허용’ 뒤에도 폴더 화면이 남는 경우 뒤로가기를 누르면 취소될 수 있습니다. 홈으로 나갔다가 업무수첩으로 돌아오면 연결 상태를 확인할 수 있습니다.";

  const note = document.createElement("p");
  note.className = "call-folder-path-note";
  note.textContent = "현재 확인된 에이닷 전화 녹음 경로입니다. 휴대폰·전화앱 버전에 따라 위치가 다를 수 있습니다.";

  guide.append(top, steps, edgeNote, note);
  importButton.insertAdjacentElement("beforebegin", guide);
}

function hideUnsupportedShortcut() {
  const shortcut = document.getElementById("callFolderShortcut");
  if (!shortcut) return;
  const primary = shortcut.querySelector(".call-folder-primary");
  if (primary?.disabled && !shortcut.querySelector(".call-folder-connection:not([hidden])")) {
    primary.hidden = true;
    shortcut.classList.add("is-fallback-only");
  }
}

buildGuide();
setTimeout(hideUnsupportedShortcut, 0);
setTimeout(hideUnsupportedShortcut, 300);
