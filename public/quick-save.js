(() => {
  const mic = document.getElementById("mic");
  const save = document.getElementById("save");
  const clear = document.getElementById("clear");
  const result = document.getElementById("result");
  const hint = document.getElementById("hint");
  if (!mic || !save || !clear || !result || !hint) return;

  const baseMicClick = mic.onclick;
  const baseSaveClick = save.onclick;
  if (typeof baseMicClick !== "function" || typeof baseSaveClick !== "function") return;

  let saving = false;

  async function saveNow() {
    if (saving) return;
    saving = true;
    mic.disabled = true;
    clear.disabled = true;

    try {
      await baseSaveClick.call(save);
      if (result.classList.contains("success")) {
        hint.textContent = "저장 완료. 말하기를 누르면 새 기록을 시작합니다.";
        try { navigator.vibrate?.([220, 100, 220]); } catch {}
      }
    } finally {
      mic.disabled = false;
      clear.disabled = false;
      saving = false;
    }
  }

  mic.onclick = async () => {
    if (saving) return;

    if (mic.classList.contains("listening")) {
      await saveNow();
      return;
    }

    await baseMicClick.call(mic);
  };

  save.onclick = saveNow;
})();
