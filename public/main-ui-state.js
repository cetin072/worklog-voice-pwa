(() => {
  const PREF_KEY = "worklogUiPreferencesV1";
  const DRAFT_KEY = "worklogDraftV1";

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

  sanitizeLegacyDraftExtras();
  window.WorklogUiPreferences = Object.freeze({ read: readPreferences, save: savePreferences });
})();
