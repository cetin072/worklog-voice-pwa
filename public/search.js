(() => {
  if (window.WorklogIntegratedSearch) return;

  const PAGE_SIZE = 20;
  const RPC_PATH = "/rest/v1/rpc/search_my_work_records";
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

  function ensureStyles() {
    if (document.querySelector('link[data-worklog-search="1"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/search.css?v=20260916-1";
    link.dataset.worklogSearch = "1";
    document.head.append(link);
  }

  function createCard() {
    const card = document.createElement("section");
    card.id = "searchCard";
    card.className = "card search-card core-app-card";
    card.setAttribute("aria-labelledby", "searchTitle");
    card.innerHTML = `
      <div class="search-head">
        <div>
          <p class="eyebrow">기록 검색</p>
          <h2 id="searchTitle">지난 업무 찾기</h2>
        </div>
      </div>
      <form id="worklogSearchForm" class="search-form" role="search">
        <input id="worklogSearchInput" type="search" inputmode="search" autocomplete="off" maxlength="120" placeholder="예: 삼현, 견적, 세금계산서" aria-label="지난 업무 검색어">
        <button id="worklogSearchSubmit" type="submit">검색</button>
      </form>
      <p id="worklogSearchStatus" class="search-status" aria-live="polite">단어나 짧은 표현으로 내 기록을 찾을 수 있습니다.</p>
      <ul id="worklogSearchResults" class="search-results" aria-live="polite"></ul>
      <button id="worklogSearchMore" class="search-more" type="button" hidden>더 보기</button>
    `;

    const anchor = document.querySelector(".voice-card.core-app-card") || document.getElementById("briefingCard");
    if (anchor?.parentNode) anchor.insertAdjacentElement("afterend", card);
    else document.querySelector("main.app")?.append(card);
    return card;
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

  function clearResults(els) {
    els.results.replaceChildren();
    els.more.hidden = true;
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
      activeController?.abort();
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
      if (activeController === controller) activeController = null;
      setLoading(els, false);
    }
  }

  function init() {
    ensureStyles();
    const card = document.getElementById("searchCard") || createCard();
    if (!card) return;

    const els = {
      card,
      form: document.getElementById("worklogSearchForm"),
      input: document.getElementById("worklogSearchInput"),
      submit: document.getElementById("worklogSearchSubmit"),
      status: document.getElementById("worklogSearchStatus"),
      results: document.getElementById("worklogSearchResults"),
      more: document.getElementById("worklogSearchMore"),
    };
    if (Object.values(els).some((value) => !value)) return;

    els.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch(els, els.input.value, 0, { append: false });
    });

    els.more.addEventListener("click", () => {
      if (loading || !currentQuery) return;
      runSearch(els, currentQuery, nextOffset, { append: true });
    });

    els.input.addEventListener("search", () => {
      if (els.input.value) return;
      currentQuery = "";
      nextOffset = 0;
      clearResults(els);
      setStatus(els.status, "단어나 짧은 표현으로 내 기록을 찾을 수 있습니다.");
    });

    window.addEventListener("worklog:platform-auth-changed", () => {
      activeController?.abort();
      currentQuery = "";
      nextOffset = 0;
      clearResults(els);
      els.input.value = "";
      const signedIn = Boolean(window.WorklogPlatformAuth?.readSession?.());
      setStatus(els.status, signedIn
        ? "단어나 짧은 표현으로 내 기록을 찾을 수 있습니다."
        : "로그인 후 기록을 검색할 수 있습니다.");
    });

    if (!window.WorklogPlatformAuth?.readSession?.()) {
      setStatus(els.status, "로그인 후 기록을 검색할 수 있습니다.");
    }
  }

  window.WorklogIntegratedSearch = Object.freeze({ init });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
