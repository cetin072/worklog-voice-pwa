import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { parseMobileBriefing } = await import('../mobile/src/platform/worklog-api.ts');
const appSource = readFileSync(new URL('../mobile/app/index.tsx', import.meta.url), 'utf8');

const baseBriefing = {
  today: '2026-09-19',
  counts: { overdue: 0, today: 0, upcoming: 0, undated: 0 },
  structure: { overdue: [], today: [], upcoming: [], undated: [] },
};

test('mobile briefing accepts the optional focus list and keeps an older response usable', () => {
  const focused = parseMobileBriefing({
    ...baseBriefing,
    resurface: [{ pageId: 'task-1', title: '견적서 보내기', status: '진행중', reason: 'attention', nextAttentionAt: '2026-09-19T09:00:00+09:00' }],
  });
  assert.equal(focused.resurface?.[0]?.reason, 'attention');
  assert.deepEqual(parseMobileBriefing(baseBriefing).resurface, []);
  assert.throws(() => parseMobileBriefing({ ...baseBriefing, resurface: {} }), /브리핑 응답/);
});

test('home summary keeps attention work in the single actionable list', () => {
  assert.match(appSource, /homeOverview\(briefing!/);
  assert.match(appSource, /overview.summary/);
  assert.doesNotMatch(appSource, /<FocusTaskRow/);
  assert.match(appSource, /completeTaskInline\(task\)/);
  assert.match(appSource, /다시 확인할 업무/);
});
