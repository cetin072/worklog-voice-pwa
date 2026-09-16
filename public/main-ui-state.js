(() => {
  const PREF_KEY = "worklogUiPreferencesV1";
  const DRAFT_KEY = "worklogDraftV1";
  const BRIEFING_SNAPSHOT_PREFIX = "worklogBriefingV2SnapshotV1:";
  const BRIEFING_DATA_PREFIX = "worklogBriefingV2DataV1:";
  const previousFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  let briefingRefreshTimer = 0;

  function readPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      return { briefingCollapsed: stored?.briefingCollapsed === true };
    } catch {
      return { briefingCollapsed: false };
    }
  }

  function savePreferences(next) {
    const value = { ...readPreferences(), ...next };
    localStorage.setItem(PREF_KEY, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("worklog:ui-preferences-changed", { detail: value }));
    return value;
  }

  function sanitizeLegacyDraftExtras() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object") return;
      const next = { ...draft, amount: "", assignee: "", dueDate: "", followUp: "" };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {}
  }

  function platformSession() {
    return window.WorklogPlatformAuth?.readSession?.() || null;
  }

  function jwtSubject() {
    const token = String(platformSession()?.access_token || "");
    const part = token.split(".")[1] || "";
    if (!part) return "";
    try {
      const normalized = part.replaceAll("-", "+").replaceAll("_", "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      return String(JSON.parse(atob(padded))?.sub || "").trim().slice(0, 200);
    } catch {
      return "";
    }
  }

  function clearBriefingCache() {
    const subject = jwtSubject();
    if (!subject) return;
    localStorage.removeItem(`${BRIEFING_SNAPSHOT_PREFIX}${subject}`);
    localStorage.removeItem(`${BRIEFING_DATA_PREFIX}${subject}`);
  }

  function requestDetails(input, init = {}) {
    const raw = typeof input === "string" ? input : input?.url || "";
    try {
      const url = new URL(raw, window.location.origin);
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      return { url, method };
    } catch {
      return { url: null, method: "GET" };
    }
  }

  function quickUpdateAction(init = {}) {
    try {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return body?.action === "quick_update";
    } catch {
      return false;
    }
  }

  if (previousFetch) {
    window.fetch = async (input, init = {}) => {
      const details = requestDetails(input, init);
      const sameOrigin = details.url?.origin === window.location.origin;

      if (sameOrigin
        && details.method === "POST"
        && details.url.pathname === "/api/briefing"
        && platformSession()?.access_token
        && quickUpdateAction(init)) {
        return new Response(JSON.stringify({ ok: true, mode: "data_core_refresh" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      const response = await previousFetch(input, init);
      if (response.ok && sameOrigin && details.method === "POST" && details.url.pathname === "/api/worklog") {
        let saved = {};
        try { saved = await response.clone().json(); } catch {}
        window.dispatchEvent(new CustomEvent("worklog:record-saved", {
          detail: {
            mode: String(saved?.mode || ""),
            workRecordId: String(saved?.dataCoreWorkRecordId || ""),
            scheduleDetected: saved?.scheduleDetected === true,
          },
        }));
      }
      return response;
    };
  }

  function triggerBriefingRefresh(attempt = 0) {
    if (typeof document === "undefined") return;
    const quick = document.getElementById("briefingQuickUpdate");
    if (!quick || quick.disabled) {
      if (attempt < 12) window.setTimeout(() => triggerBriefingRefresh(attempt + 1), 200);
      return;
    }
    quick.click();
  }

  function scheduleBriefingRefresh() {
    window.clearTimeout(briefingRefreshTimer);
    briefingRefreshTimer = window.setTimeout(() => triggerBriefingRefresh(), 120);
  }

  function installBriefingReset() {
    if (typeof document === "undefined") return;
    const actions = document.querySelector("#briefingCard .briefing-actions");
    const quick = document.getElementById("briefingQuickUpdate");
    if (!actions || !quick || document.getElementById("briefingReset")) return;
    const button = document.createElement("button");
    button.id = "briefingReset";
    button.className = "briefing-quick briefing-reset";
    button.type = "button";
    button.textContent = "↻ 브리핑 리셋";
    button.title = "저장된 브리핑을 지우고 최신 업무와 일정을 다시 불러옵니다.";
    button.addEventListener("click", () => {
      clearBriefingCache();
      window.dispatchEvent(new CustomEvent("worklog:briefing-reset"));
      scheduleBriefingRefresh();
    });
    actions.insertBefore(button, quick);
  }

  window.addEventListener?.("worklog:record-saved", scheduleBriefingRefresh);
  window.addEventListener?.("worklog:platform-auth-changed", (event) => {
    if (String(event?.detail?.state || "") === "platform-signed-in") window.setTimeout(installBriefingReset, 0);
  });
  window.addEventListener?.("DOMContentLoaded", installBriefingReset, { once: true });

  sanitizeLegacyDraftExtras();
  window.WorklogUiPreferences = Object.freeze({ read: readPreferences, save: savePreferences });
})();