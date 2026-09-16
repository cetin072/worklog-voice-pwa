(() => {
  if (window.WorklogSearchDetail) return;

  const SEARCH_HISTORY_KEY = "worklogSearchOpen";
  const DETAIL_HISTORY_KEY = "worklogSearchDetail";
  const RECORD_SELECT = [
    "id",
    "title",
    "content",
    "original_text",
    "record_type",
    "status",
    "institution",
    "amount",
    "follow_up",
    "recorded_at",
    "due_at",
    "metadata",
  ].join(",");
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

  let activeController = null;
  let openRecordId = "";
  let lastTrigger = null;

  function text(value) {
    return String(value ?? "").trim();
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function formatAmount(value) {
    if (value === null || value === undefined || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return `${new Intl.NumberFormat("ko-KR").format(number)}원`;
  }

  function trustedInstitution(row) {
    const provenance = text(row?.metadata?.institution_provenance);
    return ["user_selected", "user_confirmed"].includes(provenance) ? text(row?.institution) : "";
  }

  function ensureStyles() {
    if (document.getElementById("worklogSearchDetailStyles")) return;
    const style = document.createElement("style");
    style.id = "worklogSearchDetailStyles";
    style.textContent = `
      .search-result[data-work-record-id]{cursor:pointer;outline:none}
      .search-result[data-work-record-id]:active{transform:translateY(1px)}
      .search-result[data-work-record-id]:focus-visible{outline:3px solid rgba(17,24,39,.24);outline-offset:2px}
      .search-detail[hidden]{display:none}
      .search-detail{position:absolute;inset:0;z-index:5;background:#f3f4f6;display:flex;flex-direction:column;overflow:hidden}
      .search-detail-body{flex:1;overflow-y:auto;padding:18px 16px calc(32px + env(safe-area-inset-bottom));overscroll-behavior:contain}
      .search-detail-status{margin:4px 0 14px;color:#6b7280;font-size:.9rem}
      .search-detail-status.error{color:#b91c1c}
      .search-detail-card{border:1px solid #e5e7eb;border-radius:18px;background:#fff;padding:18px;box-shadow:0 4px 18px rgba(17,24,39,.04)}
      .search-detail-title{margin:0;color:#111827;font-size:1.25rem;line-height:1.45;overflow-wrap:anywhere}
      .search-detail-meta{display:flex;flex-wrap:wrap;gap:5px 10px;margin-top:10px;color:#6b7280;font-size:.82rem}
      .search-detail-section{margin-top:20px}
      .search-detail-section h4{margin:0 0 7px;color:#6b7280;font-size:.78rem;letter-spacing:.02em}
      .search-detail-section p{margin:0;color:#27303f;font-size:.98rem;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
      .search-detail-empty{color:#9ca3af}
      @media(min-width:560px){.search-detail-body{padding-left:20px;padding-right:20px}}
    `;
    document.head.append(style);
  }

  function createPanel(searchScreen) {
    const existing = document.getElementById("worklogSearchDetail");
    if (existing) return existing;

    const panel = document.createElement("section");
    panel.id = "worklogSearchDetail";
    panel.className = "search-detail";
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `
      <header class="search-screen-head">
        <button id="worklogSearchDetailClose" class="search-back" type="button" aria-label="검색 결과로 돌아가기">←</button>
        <div>
          <p class="eyebrow">기록 상세</p>
          <h2>업무 기록</h2>
        </div>
      </header>
      <div class="search-detail-body">
        <p id="worklogSearchDetailStatus" class="search-detail-status" aria-live="polite"></p>
        <article id="worklogSearchDetailCard" class="search-detail-card" hidden></article>
      </div>`;
    searchScreen.append(panel);
    return panel;
  }

  async function readError(response) {
    const body = await response.json().catch(() => ({}));
    return text(body?.message || body?.msg || body?.error_description || body?.hint || body?.details) || `기록을 불러오지 못했습니다. (${response.status})`;
  }

  async function fetchRecord(recordId, signal) {
    const auth = window.WorklogPlatformAuth;
    const config = await auth?.getConfig?.();
    if (!config?.supabaseUrl || !config?.publishableKey) throw new Error("기록 조회 설정을 불러오지 못했습니다.");

    let session = auth?.readSession?.();
    if (!session?.access_token) throw new Error("로그인 후 기록을 볼 수 있습니다.");

    const url = new URL(`${config.supabaseUrl}/rest/v1/work_records`);
    url.searchParams.set("id", `eq.${recordId}`);
    url.searchParams.set("select", RECORD_SELECT);
    url.searchParams.set("limit", "1");

    const request = (accessToken) => fetch(url.toString(), {
      method: "GET",
      signal,
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      cache: "no-store",
    });

    let response = await request(session.access_token);
    if (response.status === 401 && auth?.refreshSession) {
      session = await auth.refreshSession();
      if (!session?.access_token) throw new Error("로그인 세션을 갱신하지 못했습니다.");
      response = await request(session.access_token);
    }
    if (!response.ok) throw new Error(await readError(response));

    const rows = await response.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || text(row.id) !== recordId) throw new Error("이 기록을 찾지 못했거나 볼 권한이 없습니다.");
    return row;
  }

  function appendMeta(container, value) {
    if (!value) return;
    const span = document.createElement("span");
    span.textContent = value;
    container.append(span);
  }

  function appendSection(card, label, value) {
    const normalized = text(value);
    if (!normalized) return;
    const section = document.createElement("section");
    section.className = "search-detail-section";
    const heading = document.createElement("h4");
    heading.textContent = label;
    const paragraph = document.createElement("p");
    paragraph.textContent = normalized;
    section.append(heading, paragraph);
    card.append(section);
  }

  function renderRecord(els, row) {
    const card = els.card;
    card.replaceChildren();

    const title = document.createElement("h3");
    title.className = "search-detail-title";
    title.textContent = text(row?.title) || "제목 없는 기록";
    card.append(title);

    const meta = document.createElement("div");
    meta.className = "search-detail-meta";
    appendMeta(meta, STATUS_LABELS[text(row?.status)] || "");
    appendMeta(meta, TYPE_LABELS[text(row?.record_type)] || "");
    appendMeta(meta, trustedInstitution(row));
    appendMeta(meta, formatDateTime(row?.recorded_at));
    appendMeta(meta, row?.due_at ? `기한 ${formatDateTime(row.due_at)}` : "");
    appendMeta(meta, formatAmount(row?.amount));
    if (meta.childNodes.length) card.append(meta);

    const content = text(row?.content);
    const original = text(row?.original_text);
    appendSection(card, "기록 내용", content || original);
    if (original && original !== content) appendSection(card, "원문", original);
    appendSection(card, "후속조치", row?.follow_up);

    if (!content && !original && !text(row?.follow_up)) {
      const empty = document.createElement("p");
      empty.className = "search-detail-section search-detail-empty";
      empty.textContent = "표시할 상세 내용이 없습니다.";
      card.append(empty);
    }
    card.hidden = false;
  }

  function hideDetail(els, { returnFocus = true } = {}) {
    activeController?.abort();
    activeController = null;
    openRecordId = "";
    els.panel.hidden = true;
    els.panel.setAttribute("aria-hidden", "true");
    els.card.hidden = true;
    els.card.replaceChildren();
    els.status.textContent = "";
    els.status.className = "search-detail-status";
    if (returnFocus && lastTrigger?.isConnected) lastTrigger.focus();
    lastTrigger = null;
  }

  async function showDetail(els, recordId, trigger, { pushHistory = true } = {}) {
    if (!recordId) return;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    openRecordId = recordId;
    lastTrigger = trigger || lastTrigger;

    els.panel.hidden = false;
    els.panel.setAttribute("aria-hidden", "false");
    els.card.hidden = true;
    els.card.replaceChildren();
    els.status.textContent = "기록을 불러오는 중입니다.";
    els.status.className = "search-detail-status";

    if (pushHistory && window.history?.pushState) {
      window.history.pushState({
        ...(window.history.state || {}),
        [SEARCH_HISTORY_KEY]: true,
        [DETAIL_HISTORY_KEY]: recordId,
      }, "");
    }

    try {
      const row = await fetchRecord(recordId, controller.signal);
      if (controller.signal.aborted || activeController !== controller || openRecordId !== recordId) return;
      renderRecord(els, row);
      els.status.textContent = "";
      window.requestAnimationFrame(() => els.close.focus());
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (activeController !== controller || openRecordId !== recordId) return;
      els.status.textContent = text(error?.message) || "기록을 불러오지 못했습니다.";
      els.status.className = "search-detail-status error";
    } finally {
      if (activeController === controller) activeController = null;
    }
  }

  function requestClose(els) {
    if (window.history?.state?.[DETAIL_HISTORY_KEY] && window.history?.back) {
      window.history.back();
      return;
    }
    hideDetail(els);
  }

  function init() {
    ensureStyles();
    const searchScreen = document.getElementById("searchScreen");
    const results = document.getElementById("worklogSearchResults");
    if (!searchScreen || !results) return;
    const panel = createPanel(searchScreen);
    const els = {
      panel,
      close: panel.querySelector("#worklogSearchDetailClose"),
      status: panel.querySelector("#worklogSearchDetailStatus"),
      card: panel.querySelector("#worklogSearchDetailCard"),
    };
    if (Object.values(els).some((value) => !value)) return;

    results.addEventListener("click", (event) => {
      const item = event.target.closest?.(".search-result[data-work-record-id]");
      if (!item || !results.contains(item)) return;
      showDetail(els, text(item.dataset.workRecordId), item);
    });

    results.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const item = event.target.closest?.(".search-result[data-work-record-id]");
      if (!item || !results.contains(item)) return;
      event.preventDefault();
      showDetail(els, text(item.dataset.workRecordId), item);
    });

    els.close.addEventListener("click", () => requestClose(els));

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || els.panel.hidden) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestClose(els);
    }, true);

    window.addEventListener("popstate", (event) => {
      const detailId = text(event.state?.[DETAIL_HISTORY_KEY]);
      if (detailId) {
        if (detailId !== openRecordId) showDetail(els, detailId, lastTrigger, { pushHistory: false });
        return;
      }
      if (!els.panel.hidden) hideDetail(els);
    });

    window.addEventListener("worklog:platform-auth-changed", () => {
      if (!els.panel.hidden) hideDetail(els, { returnFocus: false });
    });
  }

  window.WorklogSearchDetail = Object.freeze({ init });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
