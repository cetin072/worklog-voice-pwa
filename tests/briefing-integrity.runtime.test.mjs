import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { createWorklogDataCoreBriefingSource } from '../netlify/shared/worklog-data-core-briefing-source.mjs';
import { createWorklogDataCoreBriefingReader } from '../netlify/shared/worklog-data-core-briefing-reader.mjs';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { briefingMetadata } = await import('../mobile/src/platform/briefing-metadata.ts');
const { parseMobileBriefing } = await import('../mobile/src/platform/worklog-api.ts');
const { default: fast } = await import('../netlify/functions/briefing-fast.mts');
const { default: v2 } = await import('../netlify/functions/briefing-v2.mts');
const row = (i) => ({ id: `task-${i}`, title: `Task ${i}`, status: 'in_progress', due_at: null });
const rows = (count) => Array.from({ length: count }, (_, i) => row(i));
const workspace = { userId: 'user-1', workspaceId: 'workspace-1', role: 'owner' };

test('RPC 499 complete, exactly 500 probed complete, 501 total partial; same RLS-scoped filter', async () => {
  for (const count of [499, 500, 501]) {
    const calls = [];
    const source = await createWorklogDataCoreBriefingSource({ client: {
      rpc: async () => ({ workspace_id: workspace.workspaceId, today: '2026-09-19', tasks: rows(Math.min(count, 500)), schedules: [] }),
      select: async (table, query) => { calls.push({ table, query }); return count > Number(query.offset) ? [{ id: 'extra' }] : []; },
    } }).load();
    assert.equal(source.truncated, count > 500); assert.equal(source.completeness, count > 500 ? 'partial' : 'complete');
    assert.equal(calls.length, count === 499 ? 0 : 1);
    if (calls.length) { assert.equal(calls[0].query.workspace_id, 'eq.workspace-1'); assert.equal(calls[0].query.offset, '500'); assert.equal(calls[0].query.limit, '1'); }
  }
});
test('secondary probe failure is unknown, not false; RPC malformed data never becomes zero tasks', async () => {
  const source = await createWorklogDataCoreBriefingSource({ client: {
    rpc: async () => ({ workspace_id: workspace.workspaceId, today: '2026-09-19', tasks: rows(500), schedules: [] }),
    select: async () => { throw new Error('offline'); },
  } }).load();
  assert.equal(source.truncated, null); assert.equal(source.completeness, 'unknown');
  await assert.rejects(createWorklogDataCoreBriefingSource({ client: { rpc: async () => ({ workspace_id: workspace.workspaceId, today: '2026-09-19', tasks: null, schedules: [] }) } }).load());
});
test('fallback reader detects additional tasks even if REST server limits page below 500', async () => {
  const reader = createWorklogDataCoreBriefingReader({ client: { select: async (_, q) => q.offset ? [row(101)] : rows(100) } });
  const page = await reader.listOpenTasksWithMeta(workspace);
  assert.equal(page.truncated, true); assert.equal(page.tasks.length, 100);
});
test('mobile view model distinguishes stale day, unknown coverage, partial coverage and unknown source', () => {
  const now = Date.parse('2026-09-19T00:10:00+09:00');
  const meta = briefingMetadata({ today: '2026-09-18', generatedAt: '2026-09-19T00:09:00+09:00', mode: 'data_core', completeness: 'partial', truncated: true }, now);
  assert.equal(meta.stale, true); assert.ok(meta.warnings.some((m) => m.includes('일부 업무'))); assert.ok(meta.meta.includes('Data Core'));
  const unknown = briefingMetadata({ today: '2026-09-19', generatedAt: 'bad', truncated: false }, now);
  assert.ok(unknown.warnings.some((m) => m.includes('전체 조회 여부'))); assert.ok(unknown.meta.includes('출처 확인 필요'));
  assert.throws(() => parseMobileBriefing({}), /브리핑 응답/);
});
test('real fast and v2 handlers propagate completeness through HTTP JSON, including fallback', async () => {
  const originalFetch = globalThis.fetch; const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => ({
    WORKLOG_DATA_CORE_BRIEFING_ENABLED: 'true', SUPABASE_URL: 'https://example.invalid', SUPABASE_PUBLISHABLE_KEY: 'test-only',
  })[name] } };
  try {
    for (const useFallback of [false, true]) for (const handler of [fast, v2]) {
      globalThis.fetch = async (input, init) => {
        const url = new URL(input); assert.equal(url.host, 'example.invalid');
        assert.equal(init.headers.authorization, 'Bearer test-token');
        if (url.pathname.endsWith('get_my_briefing_source')) return useFallback
          ? Response.json({ message: 'get_my_briefing_source missing in schema cache' }, { status: 404 })
          : Response.json({ workspace_id: workspace.workspaceId, today: '2026-09-19', tasks: rows(500), schedules: [] });
        if (url.pathname.endsWith('/user')) return Response.json({ id: workspace.userId });
        if (url.pathname.endsWith('bootstrap_personal_workspace')) return Response.json([{ workspace_id: workspace.workspaceId }]);
        if (url.pathname.endsWith('work_records')) return Response.json(url.searchParams.has('offset') ? [row(501)] : rows(500));
        throw new Error(`unexpected mock path: ${url.pathname}`);
      };
      const response = await handler(new Request('https://app.invalid/api/briefing', { headers: { authorization: 'Bearer test-token' } }), {});
      assert.equal(response.status, 200);
      const body = parseMobileBriefing(await response.json());
      assert.equal(body.truncated, true); assert.equal(body.completeness, 'partial');
      assert.equal(body.mode, 'data_core'); assert.equal(body.queryLimit, 500);
      assert.ok(briefingMetadata(body).warnings.some((m) => m.includes('일부 업무')));
    }
  } finally { globalThis.fetch = originalFetch; globalThis.Netlify = originalNetlify; }
});
