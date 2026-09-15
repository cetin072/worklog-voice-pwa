(() => {
  function hasPlatformSession() {
    return Boolean(window.WorklogPlatformAuth?.readSession?.()?.access_token);
  }

  function legacyMode() {
    return window.WorklogAuth?.mode?.() || "unset";
  }

  if (hasPlatformSession() || legacyMode() === "unset") return;

  const script = document.createElement("script");
  script.src = "/briefing.js?v=20260915-legacy-1";
  script.defer = true;
  document.body.appendChild(script);
})();
