const summary = document.getElementById("callSelectionSummary");
const list = document.getElementById("callInboxList");

function durationSeconds(text = "") {
  const hours = Number(text.match(/(\d+)시간/)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)분/)?.[1] || 0);
  const seconds = Number(text.match(/(\d+)초/)?.[1] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function selectedItemsFromDom() {
  if (!list) return [];
  return [...list.querySelectorAll(".call-item.selected")].map((item, index) => {
    const name = item.querySelector(".call-item-name")?.textContent?.trim() || "상대방";
    const phone = item.querySelector(".call-item-phone")?.textContent?.trim() || "";
    const meta = [...item.querySelectorAll(".call-item-meta span")].map((node) => node.textContent?.trim() || "");
    const durationText = meta.find((value) => /\d+(?:시간|분|초)/.test(value)) || "";
    return {
      id: `dom-${index}-${phone || name}`,
      contactName: name,
      phone,
      recordedAt: new Date().toISOString(),
      durationSeconds: durationSeconds(durationText),
    };
  });
}

function announce() {
  if (!summary || summary.hidden) return;
  const items = selectedItemsFromDom();
  if (!items.length) return;
  window.dispatchEvent(new CustomEvent("worklog:call-selection-ready", {
    detail: { items, source: "local-dom-metadata" },
  }));
}

if (summary && typeof MutationObserver !== "undefined") {
  const observer = new MutationObserver(() => queueMicrotask(announce));
  observer.observe(summary, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

const action = document.getElementById("callSelectionAction");
action?.addEventListener("click", () => setTimeout(announce, 0));
