export const BRIEFING_TASK_LIMIT = 500;

/** Boundaries are explicit: no SQL changes or elevated keys, only the same user's RLS read. */
export async function briefingCompleteness({ client, workspaceId, sourceCount, displayedCount, rpcBounded = false }) {
  const filteredTaskCount = Math.max(0, Math.min(sourceCount, BRIEFING_TASK_LIMIT) - displayedCount);
  const common = { queryLimit: BRIEFING_TASK_LIMIT, filteredTaskCount };
  if (sourceCount > BRIEFING_TASK_LIMIT) return { ...common, completeness: 'partial', truncated: true };
  // The checked RPC's nested task array is capped at 500. PostgREST row limits apply to the outer RPC row.
  if (rpcBounded && sourceCount < BRIEFING_TASK_LIMIT) return { ...common, completeness: filteredTaskCount ? 'partial' : 'complete', truncated: filteredTaskCount > 0 };
  try {
    if (!client || typeof client.select !== 'function') throw new Error('no pagination probe');
    const next = await client.select('work_records', {
      select: 'id', workspace_id: `eq.${workspaceId}`, status: 'in.(in_progress,waiting,needs_review)',
      order: 'updated_at.desc', offset: String(sourceCount), limit: '1',
    });
    if (!Array.isArray(next)) throw new Error('invalid pagination result');
    const truncated = next.length > 0 || filteredTaskCount > 0;
    return { ...common, completeness: truncated ? 'partial' : 'complete', truncated };
  } catch {
    // Supplemental count failure must not convert a partial read into a fake complete read.
    return { ...common, completeness: 'unknown', truncated: null };
  }
}
