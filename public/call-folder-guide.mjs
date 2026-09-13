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
  steps.textContent = "폴더 연결 화면에서는 파일이 보이지 않는 것이 정상입니다. TPhoneCallRecords까지 들어간 뒤 아래 ‘이 폴더 사용’을 누르세요.";

  const note = document.createElement("p");
  note.className = "call-folder-path-note";
  note.textContent = "일반 파일 가져오기에서는 내장 저장공간 → Recordings → TPhoneCallRecords 순서로 들어가 녹음파일을 선택하면 됩니다. 휴대폰·전화앱 버전에 따라 위치가 다를 수 있습니다.";

  guide.append(top, steps, note);
  importButton.insertAdjacentElement("beforebegin", guide);
}

function hideUnsupportedShortcut() {
  const shortcut = document.getElementById("callFolderShortcut");
  if (!shortcut) return;
  const primary = shortcut.querySelector(".call-folder-primary");
  if (primary?.disabled) {
    primary.hidden = true;
    shortcut.classList.add("is-fallback-only");
  }
}

buildGuide();
setTimeout(hideUnsupportedShortcut, 0);
setTimeout(hideUnsupportedShortcut, 300);
