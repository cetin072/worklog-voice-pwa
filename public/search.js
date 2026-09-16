(() => {
  if (window.WorklogIntegratedSearch) return;

  const PAGE_SIZE = 20;
  const RPC_PATH = "/rest/v1/rpc/search_my_work_records";
  const HISTORY_KEY = "worklogSearchOpen";
  const DETAIL_SCRIPT_PATH = "/search-detail.js?v=20260916-2";
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STATUS_LABELS = Object.freeze({
    in_progress: "진행중",
    completed: "완료",
    waiting: "대기",
    needs_review: "확인필요",
    cancelled: "취소",
  });
  const TYPE_LABELS = Object.freeze({
    completed_work: "완료업무",
    task: "할 일",
    meeting_call: "회의·통화",
    expense_tax: "지출·세무",
    delegation: "지시·위임",
    idea: "아이디어",
    issue_review: "문제·확인",
    other: "기타",
  });
  const MATCH_LABELS = Object.freeze({
    exact: "정확 일치",
    partial: "내용 일치",
    alias: "별칭 일치",
  });

  let currentQuery = "";
  let nextOffset = 0;
  let activeController = null;
  let loading = false;
  let screenOpen = false;
  let detailModulePromise = null;

  function ensureStyles() {
    if (document.querySelector('link[data-worklog-search="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/search.css?v=20260916-3";
    link.dataset.worklogSearch = "1";
    document.head.append(link);
  }

  function ensureDetailModule() {
    if (window.WorklogSearchDetail?.open) return Promise.resolve(window.WorklogSearchDetail);
    if (detailModulePromise) return detailModulePromise;

    detailModulePromise = new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-worklog-search-detail="1"]');
      const loaded = () => {
        script.dataset.loaded = "1";
        if (window.WorklogSearchDetail?.open) resolve(window.WorklogSearchDetail);
        else reject(new Error("기록 상세 기능을 불러오지 못했습니다."));
      };
      const failed = () => reject(new Error("기록 상세 기능을 불러오지 못했습니다."));

      if (!script) {
        script = document.createElement("script");
        script.src = DETAIL_SCRIPT_PATH;
        script.dataset.worklogSearchDetail = "1";
        script.addEventListener("load", loaded, { once: true });
        script.addEventListener("error", failed, { once: true });
        document.head.append(script);
        return;
      }

      if (script.dataset.loaded === "1") {
        loaded();
        return;
      }
      script.addEventListener("load", loaded, { once: true });
      script.addEventListener("error", failed, { once: true });
    }).catch((error) => {
      detailModulePromise = null;
      throw error;
    });

    return detailModulePromise;
  }

  function createOpenButton() {
    const existing = document.getElementById("worklogSearchOpen");
    if (existing) return existing;

    const button = document.createElement("button");
    button.id = "worklogSearchOpen";
    button.className = "search-open";
    button.type = "button";
    button.hidden = true;
    button.setAttribute("aria-label", "지난 업무 검색 열기");
    button.setAttribute("aria-haspopup", "dialog");
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"></path>
      </svg>
      <span class="search-open-label">검색</span>
    `;

    const actions = document.querySelector(".header-actions");
    const settings = document.getElementById("settingsOpen");
    if (actions) actions.insertBefore(button, settings || null);
    return button;
  }

  function createScreen() {
    const existing = document.getElementById("searchScreen");
    if (existing) return existing;

    const screen = document.createElement("section");
    screen.id = "searchScreen";
    screen.className = "search-screen";
    screen.hidden = true;
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-modal", "true");
    screen.setAttribute("aria-labelledby", "searchScreenTitle");
    screen.setAttribute("aria-hidden", "true");
    screen.innerHTML = `
      <div class="search-shell">
        <header class="search-screen-head">
          <button id="worklogSearchClose" class="search-back" type="button" aria-label="검색 닫기">←</button>
          <button id="worklogSearchFocus" class="search-title-action" type="button" aria-label="검색어 입력으로 이동" aria-controls="worklogSearchInput">
            <span class="eyebrow">기록 검색</span>
            <span id="searchScreenTitle" class="search-title-text">지난 업무 검색</span>
          </button>
        </header>
        <div class="search-screen-body">
          <form id="worklogSearchForm" class="search-form" role="search">
            <input id="worklogSearchInput" type="search" inputmode="search" autocomplete="off" maxlength="120" placeholder="기관명, 담당자, 업무 키워드 검색" aria-label="지난 업무 검색어">
            <button id="worklogSearchSubmit" type="submit">검색</button>
          </form>
          <p id="worklogSearchStatus" class="search-status" aria-live="polite">단어나 짧은 표현으로 내 기록을 찾을 수 있습니다.</p>
          <ul id="worklogSearchResults" class="search-results" aria-live="polite"></ul>
          <button id="worklogSearchMore" class="search-more" type="button" hidden>더 보기</button>
        </div>
      </div>
    `;
    document.body.append(screen);
    return screen;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function workRecordId(value) {
    const normalized = text(value);
    return UUID_RE.test(normalized) ? normalized : "";
  }

  function normalizeQuery(value) {
    return text(value).replace(/\s+/g, " ").slice(0, 120);
  }

  function setStatus(element, message = "", kind = "") {
    element.textContent = message;
    element.className = `search-status ${kind}`.trim();
  }

  function setLoading(els, value, { more = false } = {}) {
    loading = value;
    els.submit.disabled = value;
    els.input.disabled = value;
    els.more.disabled = value;
    if (value) {
      if (more) els.more.textContent = "불러오는 중…";
      else els.submit.textContent = "검색 중…";
    } else {
      els.submit.textContent = "검색";
      els.more.textContent = "더 보기";
    }
  }

  function cancelActiveSearch(els) {
    const controller = activeController;
    activeController = null;
    controller?.abort();
    setLoading(els, false);
  }

  function clearResults(els) {
    els.results.replaceChildren();
    els.more.hidden = true;
  }

  function focusSearchInput(els) {
    els.input.focus();
  }

  function createMetaItem(value) {
    const span = document.createElement("span");
    span.textContent = value;
    return span;
  }

  function renderResult(row) {
    const li = document.createElement("li");
    li.className = "search-result";

    const head = document.createElement("div");
    head.className = "search-result-head";

    const title = document.createElement("h3");
    title.className = "search-result-title";
    title.textContent = text(row?.title) || "제목 없는 기록";

    const recordId = workRecordId(row?.work_record_id);
    if (recordId) {
      li.dataset.workRecordId = recordId;
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", `${title.textContent} 상세 보기`);
    }

    const match = document.createElement("span");
    match.className = "search-match";
    match.textContent = MATCH_LABELS[text(row?.match_type)] || "일치";

    head.append(title, match);
    li.append(head);

    const metaValues = [
      text(row?.institution),
      STATUS_LABELS[text(row?.status)] || "",
      TYPE_LABELS[text(row?.record_type)] || "",
      formatDate(row?.recorded_at),
      text(row?.workspace_name),
    ].filter(Boolean);

    if (metaValues.length) {
      const meta = document.createElement("div");
      meta.className = "search-result-meta";
      metaValues.forEach((value) => meta.append(createMetaItem(value)));
      li.append(meta);
    }

    const snippetValue = text(row?.snippet);
    if (snippetValue) {
      const snippet = document.createElement("p");
      snippet.className = "search-result-snippet";
      snippet.textContent = snippetValue;
      li.append(snippet);
    }

    return li;
  }

  function renderRows(els, rows, { append = false } = {}) {
    if (!append) els.results.replaceChildren();
    rows.forEach((row) => els.results.append(renderResult(row)));
  }

  async function openResultDetail(els, item) {
    const recordId = workRecordId(item?.dataset?.workRecordId);
    if (!recordId) return;
    item.setAttribute("aria-busy", "true");
    try {
      const detail = await ensureDetailModule();
      await detail.open(recordId, item);
    } catch (error) {
      setStatus(els.status, text(error?.message) || "기록 상세를 열지 못했습니다.", "error");
    } finally {
      item.removeAttribute("aria-busy");
    }
  }

  async function readError(response) {
    const body = await response.json().catch(() => ({}));
    return text(body?.message || body?.msg || body?.error_description || body?.hint || body?.details) || `검색 요청에 실패했습니다. (${response.status})`;
  }

  async function rpcFetch(body, signal) {
    const auth = window.WorklogPlatformAuth;
    const config = await auth?.getConfig?.();
    if (!config?.supabaseUrl || !config?.publishableKey) throw new Error("검색 설정을 불러오지 못했습니다.");

    let session = auth?.readSession?.();
    if (!session?.access_token) throw new Error("로그인 후 기록을 검색할 수 있습니다.");

    const request = async (accessToken) => fetch(`${config.supabaseUrl}${RPC_PATH}`, {
      method: "POST",
      signal,
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    let response = await request(session.access_token);
    if (response.status === 401 && auth?.refreshSession) {
      session = await auth.refreshSession();
      if (!session?.access_token) throw new Error("로그인 세션을 갱신하지 못했습니다.");
      response = await request(session.access_token);
    }

    if (!response.ok) throw new Error(await readError(response));
    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  }

  async function runSearch(els, query, offset = 0, { append = false } = {}) {
    const normalized = normalizeQuery(query);
    if (!normalized) {
      cancelActiveSearch(els);
      currentQuery = "";
      nextOffset = 0;
      clearResults(els);
      setStatus(els.status, "검색어를 입력해 주세요.");
      els.input.focus();
      return;
    }

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    setLoading(els, true, { more: append });
    setStatus(els.status, append ? "다음 기록을 불러오는 중입니다." : `“${normalized}” 검색 중…`);

    try {
      const rows = await rpcFetch({
        p_query: normalized,
        p_limit: PAGE_SIZE + 1,
        p_offset: offset,
      }, controller.signal);
      if (controller.signal.aborted) return;

      const visibleRows = rows.slice(0, PAGE_SIZE);
      const hasMore = rows.length > PAGE_SIZE;
      if (!append && visibleRows.length === 0) {
        clearResults(els);
        const empty = document.createElement("li");
        empty.className = "search-empty";
        empty.textContent = "일치하는 기록이 없습니다. 다른 단어나 기관명으로 검색해 보세요.";
        els.results.append(empty);
        setStatus(els.status, `“${normalized}” 검색 결과가 없습니다.`);
        return;
      }

      renderRows(els, visibleRows, { append });
      currentQuery = normalized;
      nextOffset = offset + visibleRows.length;
      els.more.hidden = !hasMore;
      setStatus(els.status, append
        ? `${nextOffset}건까지 불러왔습니다.`
        : `${visibleRows.length}건을 찾았습니다${hasMore ? ". 더 볼 수 있습니다." : "."}`);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (!append) clearResults(els);
      setStatus(els.status, text(error?.message) || "검색 중 오류가 발생했습니다.", "error");
    } finally {
      if (activeController !== controller) return;
      activeController = null;
      setLoading(els, false);
    }
  }

  function signedIn() {
    return Boolean(window.WorklogPlatformAuth?.readSession?.()?.access_token);
  }

  function clearHistoryFlag() {
    if (!window.history?.replaceState || !window.history.state?.[HISTORY_KEY]) return;
    const next = { ...(window.history.state || {}) };
    delete next[HISTORY_KEY];
    window.history.replaceState(next, "");
  }

  function showScreen(els, { pushHistory = true } = {}) {
    if (!signedIn()) return;
    if (screenOpen) {
      focusSearchInput(els);
      return;
    }

    screenOpen = true;
    els.screen.hidden = false;
    els.screen.setAttribute("aria-hidden", "false");
    document.body.classList.add("search-screen-open");
    ensureDetailModule().catch(() => {});

    if (pushHistory && window.history?.pushState && !window.history.state?.[HISTORY_KEY]) {
      window.history.pushState({ ...(window.history.state || {}), [HISTORY_KEY]: true }, "");
    }

    window.requestAnimationFrame(() => focusSearchInput(els));
  }

  function hideScreen(els, { returnFocus = true } = {}) {
    cancelActiveSearch(els);
    if (!screenOpen) return;
    screenOpen = false;
    els.screen.hidden = true;
    els.screen.setAttribute("aria-hidden", "true");
    document.body.classList.remove("search-screen-open");
    if (returnFocus && !els.open.hidden) els.open.focus();
  }

  function requestClose(els) {
    if (window.history?.state?.[HISTORY_KEY] && window.history?.back) {
      window.history.back();
      return;
    }
    hideScreen(els);
  }

  function syncAvailability(els) {
    const available = signedIn();
    els.open.hidden = !available;
    if (!available && screenOpen) {
      clearHistoryFlag();
      hideScreen(els, { returnFocus: false });
    }
  }

  function init() {
    ensureStyles();
    const open = createOpenButton();
    const screen = createScreen();
    if (!open || !screen) return;

    const els = {
      open,
      screen,
      close: document.getElementById("worklogSearchClose"),
      focus: document.getElementById("worklogSearchFocus"),
      form: document.getElementById("worklogSearchForm"),
      input: document.getElementById("worklogSearchInput"),
      submit: document.getElementById("worklogSearchSubmit"),
      status: document.getElementById("worklogSearchStatus"),
      results: document.getElementById("worklogSearchResults"),
      more: document.getElementById("worklogSearchMore"),
    };
    if (Object.values(els).some((value) => !value)) return;

    els.open.addEventListener("click", () => showScreen(els));
    els.close.addEventListener("click", () => requestClose(els));
    els.focus.addEventListener("click", () => focusSearchInput(els));

    els.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch(els, els.input.value, 0, { append: false });
    });

    els.results.addEventListener("click", (event) => {
      const item = event.target.closest?.(".search-result[data-work-record-id]");
      if (!item || !els.results.contains(item)) return;
      openResultDetail(els, item);
    });

    els.results.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const item = event.target.closest?.(".search-result[data-work-record-id]");
      if (!item || !els.results.contains(item)) return;
      event.preventDefault();
      openResultDetail(els, item);
    });

    els.more.addEventListener("click", () => {
      if (loading || !currentQuery) return;
      runSearch(els, currentQuery, nextOffset, { append: true });
    });

    els.input.addEventListener("search", () => {
      if (els.input.value) return;
      cancelActiveSearch(els);
      currentQuery = "";
      nextOffset = 0;
      clearResults(els);
      setStatus(els.status, "단어나 짧은 표현으로 내 기록을 찾을 수 있습니다.");
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && screenOpen) requestClose(els);
    });

    window.addEventListener("popstate", (event) => {
      if (event.state?.[HISTORY_KEY]) {
        showScreen(els, { pushHistory: false });
        return;
      }
      if (screenOpen) hideScreen(els);
    });

    window.addEventListener("worklog:platform-auth-changed", () => {
      cancelActiveSearch(els);
      currentQuery = "";
      nextOffset = 0;
      clearResults(els);
      els.input.value = "";
      syncAvailability(els);
      setStatus(els.status, signedIn()
        ? "단어나 짧은 표현으로 내 기록을 찾을 수 있습니다."
        : "로그인 후 기록을 검색할 수 있습니다.");
    });

    syncAvailability(els);
  }

  window.WorklogIntegratedSearch = Object.freeze({ init });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();