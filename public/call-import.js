(() => {
  const importButton = document.getElementById("importCall");
  const text = document.getElementById("text");
  const type = document.getElementById("type");
  const result = document.getElementById("result");
  const hint = document.getElementById("hint");
  const clear = document.getElementById("clear");

  if (!text || !type || !result || !hint) return;

  function normalize(value) {
    return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  }

  function showResult(message, kind = "") {
    result.textContent = message;
    result.className = `result ${kind}`.trim();
  }

  function importCallText(value, source = "call") {
    const transcript = normalize(value);
    if (!transcript) {
      showResult("가져올 통화 텍스트가 없습니다.", "error");
      return false;
    }

    text.value = transcript;
    text.dispatchEvent(new Event("input", {bubbles: true}));

    // 통화 원문은 하나의 기록으로 보존하고, 후속 업무 분리는 나중 단계에서 처리한다.
    type.value = "회의·통화";
    type.dispatchEvent(new Event("change", {bubbles: true}));
    document.body.dataset.importSource = "call";

    hint.textContent = "통화 텍스트를 가져왔습니다. 내용을 확인한 뒤 Notion에 저장하세요.";
    showResult(source === "share"
      ? "✓ 공유된 통화 텍스트를 가져왔습니다."
      : "✓ 클립보드의 통화 텍스트를 가져왔습니다.", "success");
    text.focus();
    return true;
  }

  async function importFromClipboard() {
    if (!navigator.clipboard?.readText) {
      showResult("이 브라우저에서는 클립보드 자동 가져오기를 지원하지 않습니다. 통화 텍스트를 복사한 뒤 입력 칸에 붙여넣어 주세요.", "error");
      return;
    }

    importButton.disabled = true;
    const original = importButton.textContent;
    importButton.textContent = "통화기록 불러오는 중…";

    try {
      const clipboardText = await navigator.clipboard.readText();
      importCallText(clipboardText, "clipboard");
    } catch {
      showResult("클립보드를 읽지 못했습니다. 삼성 통화 텍스트를 복사한 뒤 다시 눌러주세요.", "error");
    } finally {
      importButton.disabled = false;
      importButton.textContent = original;
    }
  }

  if (importButton) importButton.addEventListener("click", importFromClipboard);

  const params = new URLSearchParams(window.location.search);
  const sharedTitle = normalize(params.get("shared_title"));
  const sharedText = normalize(params.get("shared_text"));
  const sharedUrl = normalize(params.get("shared_url"));

  if (sharedTitle || sharedText || sharedUrl) {
    const parts = [];
    if (sharedTitle) parts.push(sharedTitle);
    if (sharedText && sharedText !== sharedTitle) parts.push(sharedText);
    if (!sharedText && sharedUrl) parts.push(sharedUrl);

    importCallText(parts.join("\n"), "share");
    history.replaceState({}, document.title, window.location.pathname);
  }

  clear?.addEventListener("click", () => {
    delete document.body.dataset.importSource;
  });

  window.__worklogCallImport = {importCallText};
})();
