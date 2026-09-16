(() => {
  const CACHE_PREFIX = "worklogBriefingV2SnapshotV1:";
  const DATA_PREFIX = "worklogBriefingV2DataV1:";
  const CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
  const CACHE_MAX_HTML = 600000;
  const nativeFetch = window.fetch.bind(window);
  let bridgeAttached = false;

  function platformSession() {
    return window.WorklogPlatformAuth?.readSession?.() || null;
  }

  function hasPlatformSession() {
    return Boolean(platformSession()?.access_token);
  }

  function legacyMode() {
    return window.WorklogAuth?.mode?.() || "unset";
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

  function cacheKey(prefix = CACHE_PREFIX) {
    const subject = jwtSubject();
    return subject ? `${prefix}${subject}` : "";
  }

  function clearCurrentSnapshot() {
    const snapshotKey = cacheKey();
    const dataKey = cacheKey(DATA_PREFIX);
    if (snapshotKey) localStorage.removeItem(snapshotKey);
    if (dataKey) localStorage.removeItem(dataKey);
  }

  function clearAllSnapshots() {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index) || "";
      if (key.startsWith(CACHE_PREFIX) || key.startsWith(DATA_PREFIX)) localStorage.removeItem(key);
    }
  }

  function requestDetails(input, init = {}) {
    const raw = typeof input === "string" ? input : input?.url || "";
    let url;
    try { url = new URL(raw, window.location.origin); }
    catch { return { url: null, method: "GET" }; }
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    return { url, method };
  }

  function isMutationPath(pathname) {
    return ["/api/briefing-v2", "/api/briefing", "/api/worklog", "/api/worklog-edit"].includes(pathname);
  }

  async function rememberBriefingResponse(response) {
    const key = cacheKey(DATA_PREFIX);
    if (!key || !response?.ok) return;
    try {
      const data = await response.clone().json();
      if (!data?.ok || data?.mode !== "data_core" || !data?.generatedAt || !data?.structure) return;
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    } catch {}
  }

  function cachedBriefingResponse() {
    const key = cacheKey(DATA_PREFIX);
    if (!key) return null;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      if (!stored?.savedAt || Date.now() - Number(stored.savedAt) > CACHE_MAX_AGE_MS || !stored?.data?.structure) {
        localStorage.removeItem(key);
        return null;
      }
      const data = { ...stored.data, cachedSnapshot: true };
      window.setTimeout(() => {
        const meta = document.getElementById("briefingMeta");
        if (meta && !meta.textContent.includes("저장된 브리핑")) {
          meta.textContent = `${meta.textContent} · 저장된 브리핑 · 최신화 실패`;
        }
      }, 0);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "x-worklog-cache": "stale" },
      });
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  async function originalBriefingOrCache(input, init) {
    try {
      const response = await nativeFetch(input, init);
      if (response.ok) {
        await rememberBriefingResponse(response);
        return response;
      }
      if (response.status < 500) return response;
      return cachedBriefingResponse() || response;
    } catch (error) {
      const cached = cachedBriefingResponse();
      if (cached) return cached;
      throw error;
    }
  }

  window.fetch = async (input, init = {}) => {
    const details = requestDetails(input, init);
    if (details.url?.origin === window.location.origin
      && details.method === "GET"
      && details.url.pathname === "/api/briefing-v2"
      && hasPlatformSession()) {
      const fastUrl = new URL("/api/briefing-fast", window.location.origin);
      fastUrl.search = details.url.search;
      const fastInput = typeof input === "string"
        ? `${fastUrl.pathname}${fastUrl.search}`
        : new Request(fastUrl.href, input);
      try {
        const fastResponse = await nativeFetch(fastInput, init);
        if (fastResponse.ok) {
          await rememberBriefingResponse(fastResponse);
          return fastResponse;
        }
        if ([400, 401, 403].includes(fastResponse.status)) return fastResponse;
        return originalBriefingOrCache(input, init);
      } catch {
        return originalBriefingOrCache(input, init);
      }
    }

    const response = await nativeFetch(input, init);
    if (response.ok
      && details.url?.origin === window.location.origin
      && details.method !== "GET"
      && isMutationPath(details.url.pathname)) {
      clearCurrentSnapshot();
    }
    return response;
  };

  function safeSnapshotHtml(value) {
    const html = String(value || "");
    if (!html || html.length > CACHE_MAX_HTML) return "";
    if (/<script\b|javascript:|\son\w+\s*=/i.test(html)) return "";
    return html;
  }

  function readSnapshot() {
    const key = cacheKey();
    if (!key) return null;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      const savedAt = Number(stored?.savedAt || 0);
      const html = safeSnapshotHtml(stored?.html);
      if (!savedAt || Date.now() - savedAt > CACHE_MAX_AGE_MS || !html) {
        localStorage.removeItem(key);
        return null;
      }
      return {
        savedAt,
        html,
        title: String(stored?.title || "오늘 업무 상황").slice(0, 120),
        meta: String(stored?.meta || "").slice(0, 300),
      };
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  function saveSnapshot() {
    const key = cacheKey();
    const root = document.getElementById("briefingV2");
    const title = document.getElementById("briefingTitle");
    const meta = document.getElementById("briefingMeta");
    if (!key || !root || root.hidden || !title || !meta) return;
    if (!meta.textContent.includes("Data Core 기준") || meta.textContent.includes("저장된 브리핑")) return;
    const html = safeSnapshotHtml(root.innerHTML);
    if (!html) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        savedAt: Date.now(),
        html,
        title: title.textContent || "오늘 업무 상황",
        meta: meta.textContent || "",
      }));
    } catch {}
  }

  function restoreSnapshot() {
    const snapshot = readSnapshot();
    if (!snapshot) return false;
    const card = document.getElementById("briefingCard");
    const root = document.getElementById("briefingV2");
    const title = document.getElementById("briefingTitle");
    const meta = document.getElementById("briefingMeta");
    const error = document.getElementById("briefingError");
    const legacyTop = document.getElementById("briefingTop");
    const legacyMore = card?.querySelector?.(".briefing-more");
    if (!card || !root || !title || !meta || !error || !legacyTop) return false;

    root.innerHTML = snapshot.html;
    root.hidden = false;
    legacyTop.hidden = true;
    legacyMore?.setAttribute("hidden", "");
    const toggle = card.querySelector(".briefing-top-toggle");
    if (toggle) toggle.hidden = true;
    title.textContent = snapshot.title;
    meta.textContent = [snapshot.meta, "저장된 브리핑 · 업데이트 중"].filter(Boolean).join(" · ");
    error.textContent = "";
    card.classList.remove("has-error");
    return true;
  }

  function attachSnapshotBridge() {
    if (bridgeAttached) return;
    const card = document.getElementById("briefingCard");
    if (!card || !hasPlatformSession()) return;
    let rootObserver = null;
    let saveTimer = 0;

    const connect = () => {
      const root = document.getElementById("briefingV2");
      const meta = document.getElementById("briefingMeta");
      if (!root || !meta) return false;
      bridgeAttached = true;
      restoreSnapshot();
      const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = window.setTimeout(saveSnapshot, 80);
      };
      rootObserver?.disconnect();
      rootObserver = new MutationObserver(scheduleSave);
      rootObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
      const metaObserver = new MutationObserver(scheduleSave);
      metaObserver.observe(meta, { childList: true, subtree: true, characterData: true });
      return true;
    };

    if (connect()) return;
    const cardObserver = new MutationObserver(() => {
      if (connect()) cardObserver.disconnect();
    });
    cardObserver.observe(card, { childList: true, subtree: true });
  }

  window.addEventListener("worklog:platform-auth-changed", (event) => {
    const state = String(event?.detail?.state || "");
    if (state === "platform-signed-out") {
      bridgeAttached = false;
      clearAllSnapshots();
    }
    if (state === "platform-signed-in") window.setTimeout(attachSnapshotBridge, 0);
  });

  if (hasPlatformSession()) window.setTimeout(attachSnapshotBridge, 0);

  if (hasPlatformSession() || legacyMode() === "unset") return;

  const script = document.createElement("script");
  script.src = "/briefing.js?v=20260915-legacy-1";
  script.defer = true;
  document.body.appendChild(script);
})();
