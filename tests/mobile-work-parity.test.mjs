import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const apiSource = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');
const homeSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('Mobile work status reuses the authenticated Data Core briefing mutation contract', () => {
  assert.match(apiSource, /updateWorklogStatus/);
  assert.match(apiSource, /\/api\/briefing-v2/);
  assert.match(apiSource, /recordId, status/);
  assert.match(apiSource, /authorization: `Bearer \$\{accessToken\}`/);
});

test('Mobile work parity exposes completion and undo inline on the home briefing', () => {
  assert.match(homeSource, /completeTaskInline/);
  assert.match(homeSource, /onComplete=\{\(\) => void completeTaskInline\(task\)\}/);
  assert.match(homeSource, /undoCompletedTask/);
  assert.match(homeSource, /실행 취소/);
  assert.match(homeSource, /updateWorklogStatus\(session\.access_token, task\.pageId, '완료'\)/);
  assert.match(homeSource, /업무 상세/);
  assert.match(homeSource, /상태 변경/);
});

test('Top-level work search remains directly accessible without a dedicated work tab', () => {
  assert.match(homeSource, /accessibilityLabel="과거 업무 검색"/);
  assert.match(homeSource, /setScreen\('recordSearch'\)/);
  assert.doesNotMatch(homeSource, /PrimaryNavigation/);
});
