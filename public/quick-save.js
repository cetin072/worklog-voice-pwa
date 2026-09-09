(() => {
  const mic = document.getElementById("mic");
  const save = document.getElementById("save");
  const clear = document.getElementById("clear");
  const result = document.getElementById("result");
  const hint = document.getElementById("hint");
  const text = document.getElementById("text");
  const institution = document.getElementById("institution");
  const status = document.getElementById("status");
  const type = document.getElementById("type");
  const amount = document.getElementById("amount");
  const assignee = document.getElementById("assignee");
  const dueDate = document.getElementById("dueDate");
  const followUp = document.getElementById("followUp");

  if (!mic || !save || !clear || !result || !hint || !text) return;

  const baseMicClick = mic.onclick;
  const baseSaveClick = save.onclick;
  const baseClearClick = clear.onclick;
  if (typeof baseMicClick !== "function" || typeof baseSaveClick !== "function") return;

  // Galaxy/Chrome may return progressively expanded recognition fragments.
  // Treat a direct character prefix as replacement, not as a new sentence.
  if (typeof window.mergeWithOverlap === "function") {
    const previousMerge = window.mergeWithOverlap;
    window.mergeWithOverlap = (base, addition) => {
      const left = String(base || "").replace(/\s+/g, " ").trim();
      const right = String(addition || "").replace(/\s+/g, " ").trim();
      if (!left) return right;
      if (!right) return left;
      if (left === right) return left;
      if (right.startsWith(left)) return right;
      if (left.endsWith(right)) return left;
      return previousMerge(left, right);
    };
  }

  const SPLIT_MARKER = "<<<WORK_SPLIT>>>";
  const SPLIT_RE = /(?:^|\s)(?:(?:그리고\s+)?(?:그\s*다음|그다음)(?:\s*(?:업무|건|거|내용|일정|할\s*일)(?:은|는|도|으로)?)?|(?:그리고\s+)?다음\s*(?:업무|건|거|내용|일정|할\s*일)(?:은|는|도|으로)?|(?:그리고\s+)?다음(?:은|으로)|또\s+다른\s+(?:업무|건|거|일|일정)(?:은|는|도)?|별개(?:의)?\s+(?:업무|건|일)|별도\s+(?:업무|건|일)|새(?:로운)?\s+(?:업무|건|일)|두\s*번째\s+(?:업무|건|일)|세\s*번째\s+(?:업무|건|일)|네\s*번째\s+(?:업무|건|일))(?=\s|[,.!?]|$)/gi;

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function splitWorkItems(transcript) {
    const source = normalize(transcript);
    if (!source) return [];

    const marked = source.replace(SPLIT_RE, ` ${SPLIT_MARKER} `);
    return marked
      .split(SPLIT_MARKER)
      .map(part => normalize(part).replace(/^[,.;:!?\-–—]+\s*/, ""))
      .filter(Boolean);
  }

  function likelyTaejang(value) {
    const s = normalize(value);
    if (s.includes("태장")) return true;
    if (!/^(기장|퇴장|대장)(\s|$)/.test(s)) return false;
    return /(홈페이지|도메인|모회사|직원|장애인|제조|테라리움|민화|범한|삼현|현대비앤지|청우|환경정비|업무|회의|미팅|납품|지원금)/.test(s);
  }

  function isTouched(id) {
    return Boolean(window.WorklogInferenceGuard?.isTouched?.(id));
  }

  function inferFields(segment, fallback) {
    const s = normalize(segment);
    let inferredInstitution = fallback.institution;
    if (!isTouched("institution")) {
      if (likelyTaejang(s)) inferredInstitution = "태장";
      else if (s.includes("미래원") || s.includes("미래여성가족")) inferredInstitution = "미래여성가족진흥원";
    }

    const done = /(완료|마무리|처리했|보냈|전달했|확인했|송금했|끝냈|했음|하였음|했다|됐음|되었음)/.test(s);
    const future = /(내일|해야|예정|필요|확인해야|요청해야|추후|다음\s*주|다음주)/.test(s);
    const inferredStatus = isTouched("status")
      ? fallback.status
      : done ? "완료" : future ? "대기" : "진행중";

    let inferredType = "기타";
    if (/(송금|지출|세금|원천징수|비용|결제)/.test(s)) inferredType = "지출·세무";
    else if (/(회의|미팅|통화|전화)/.test(s)) inferredType = "회의·통화";
    else if (/(요청|지시|위임)/.test(s)) inferredType = "지시·위임";
    else if (/(아이디어|생각|검토안)/.test(s)) inferredType = "아이디어";
    else if (/(문제|오류|누수|확인해야)/.test(s)) inferredType = "문제·확인";
    else if (done) inferredType = "완료업무";
    else if (future) inferredType = "할 일";
    if (isTouched("type")) inferredType = fallback.type;

    return {
      institution: inferredInstitution,
      status: inferredStatus,
      type: inferredType
    };
  }

  async function postItem(segment, key, fallback) {
    const inferred = inferFields(segment, fallback);
    const response = await fetch("/api/worklog", {
      method: "POST",
      headers: {"content-type": "application/json", "x-worklog-key": key},
      body: JSON.stringify({
        transcript: segment,
        institution: inferred.institution,
        status: inferred.status,
        type: inferred.type,
        amount: null,
        assignee: "",
        dueDate: null,
        followUp: "",
        recordedAt: new Date().toISOString()
      })
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem("worklogAccessKey");
      throw new Error("개인 접근키가 맞지 않습니다. 다시 저장하면 새로 입력할 수 있습니다.");
    }
    if (!response.ok) throw new Error(data.error || "저장에 실패했습니다.");
    return data;
  }

  function hasManualExtras() {
    return Boolean(
      amount?.value ||
      assignee?.value?.trim() ||
      dueDate?.value ||
      followUp?.value?.trim()
    );
  }

  function preserveRemaining(items) {
    const remaining = items.join(" 다음 업무 ");
    text.value = remaining;
    text.dispatchEvent(new Event("input", {bubbles: true}));
  }

  let saving = false;

  async function saveMultiple(items) {
    const getAccessKey = window.getAccessKey;
    if (typeof getAccessKey !== "function") {
      throw new Error("저장 설정을 불러오지 못했습니다.");
    }

    const key = getAccessKey();
    if (!key) throw new Error("개인 접근키가 필요합니다.");

    const fallback = {
      institution: institution?.value || "기타",
      status: status?.value || "진행중",
      type: type?.value || "기타"
    };

    let savedCount = 0;
    for (let i = 0; i < items.length; i++) {
      try {
        save.textContent = `${i + 1}/${items.length} 저장 중…`;
        await postItem(items[i], key, fallback);
        savedCount += 1;
      } catch (error) {
        preserveRemaining(items.slice(i));
        throw new Error(`${savedCount}/${items.length}건 저장됨. 남은 ${items.length - savedCount}건은 화면에 보존했습니다. ${error.message || "저장 실패"}`);
      }
    }

    if (typeof baseClearClick === "function") await baseClearClick.call(clear);
    result.textContent = `✓ ${savedCount}건 Notion에 저장 완료`;
    result.className = "result success";
    save.textContent = `✓ ${savedCount}건 저장 완료`;
    if (typeof window.playSuccessFeedback === "function") window.playSuccessFeedback();
  }

  async function saveNow() {
    if (saving) return;
    saving = true;
    mic.disabled = true;
    clear.disabled = true;
    if (typeof window.primeSuccessAudio === "function") window.primeSuccessAudio();

    try {
      if (mic.classList.contains("listening") && typeof window.stopListening === "function") {
        save.disabled = true;
        save.textContent = "마지막 음성 확인 중…";
        await window.stopListening();
        save.disabled = false;
      }

      const transcript = normalize(text.value);
      const items = splitWorkItems(transcript);

      if (items.length <= 1 || hasManualExtras()) {
        await baseSaveClick.call(save);
      } else {
        save.disabled = true;
        result.textContent = `${items.length}개 업무로 나눠 저장합니다…`;
        result.className = "result";
        await saveMultiple(items);
      }

      if (result.classList.contains("success")) {
        hint.textContent = items.length > 1
          ? `${items.length}개 업무로 나눠 저장했습니다. 말하기를 누르면 새 기록을 시작합니다.`
          : "저장 완료. 말하기를 누르면 새 기록을 시작합니다.";
        try { navigator.vibrate?.([220, 100, 220]); } catch {}
      }
    } catch (error) {
      result.textContent = error.message || "저장에 실패했습니다.";
      result.className = "result error";
    } finally {
      save.disabled = false;
      mic.disabled = false;
      clear.disabled = false;
      if (!result.classList.contains("success")) save.textContent = "Notion에 저장";
      else setTimeout(() => { save.textContent = "Notion에 저장"; }, 1400);
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

  window.__worklogSplitTest = {splitWorkItems, inferFields};
})();
