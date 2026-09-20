const OPEN = new Set(["진행중", "대기", "확인필요"]);
const SYSTEM = new Set(["SYSTEM_DAILY_BRIEFING", "SYSTEM_SPLIT_SOURCE", "SYSTEM_TEST"]);

function text(value) { return String(value || "").trim(); }
function iso(value) { const date = new Date(String(value || "")); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; }

/** Deterministically selects tasks that need attention without scheduling Push. */
export function selectResurfaceTasks(rawTasks, { now = new Date().toISOString(), today } = {}) {
  const nowIso = iso(now);
  if (!nowIso || !/^\d{4}-\d{2}-\d{2}$/.test(String(today || ""))) throw new Error("valid now and today are required");
  const candidates = [];
  for (const raw of Array.isArray(rawTasks) ? rawTasks : []) {
    const status = text(raw?.status);
    const project = text(raw?.project);
    const title = text(raw?.title);
    const kind = text(raw?.actionKind);
    if (!title || !OPEN.has(status) || kind === "note" || SYSTEM.has(project)) continue;
    const nextAttentionAt = iso(raw?.nextAttentionAt);
    const dueKey = text(raw?.dueKey);
    let reason = "";
    let rank = 9;
    let moment = "";
    if (nextAttentionAt && nextAttentionAt > nowIso) continue;
    if (nextAttentionAt) { reason = "attention"; rank = 0; moment = nextAttentionAt; }
    else if (dueKey && dueKey < today) { reason = "overdue"; rank = 1; moment = `${dueKey}T00:00:00.000Z`; }
    else if (dueKey === today) { reason = "today"; rank = 2; moment = `${dueKey}T00:00:00.000Z`; }
    if (!reason) continue;
    candidates.push({ ...raw, nextAttentionAt, dueKey, reason, rank, moment, editedAt: text(raw?.editedAt) });
  }
  return candidates.sort((a, b) => a.rank - b.rank || a.moment.localeCompare(b.moment) || b.editedAt.localeCompare(a.editedAt) || text(a.pageId).localeCompare(text(b.pageId)));
}
