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

test('home focus layer shows real work rather than counts, maps human reasons, and retains primary completion', () => {
  assert.match(appSource, /const focusTasks = briefing\?\.resurface \|\| \[\]/);
  assert.match(appSource, /const visibleFocusTasks = focusExpanded \? focusTasks : focusTasks\.slice\(0, 3\)/);
  assert.match(appSource, /const extraFocusTasks = Math\.max\(0, focusTasks\.length - 3\)/);
  assert.match(appSource, /다시 확인할 시간/);
  assert.match(appSource, /오늘까지/);
  assert.match(appSource, /\$\{days\}일 지남/);
  assert.match(appSource, /<FocusTaskRow/);
  assert.match(appSource, /completeTaskInline\(task\)/);
  assert.match(appSource, /\$\{extraFocusTasks\}개 더 보기/);
  assert.match(appSource, /지금 확인할 업무가 없습니다\./);
  assert.doesNotMatch(appSource, /countGrid|countToneStyles/);
});

