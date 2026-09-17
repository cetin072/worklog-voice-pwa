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

test('Mobile work parity supplies local search, a task detail screen, and state choices', () => {
  assert.match(homeSource, /업무 검색/);
  assert.match(homeSource, /검색 결과가 없습니다/);
  assert.match(homeSource, /업무 상세/);
  assert.match(homeSource, /상태 변경/);
  for (const status of ['완료', '진행중', '대기', '확인필요']) assert.match(homeSource, new RegExp(status));
  assert.match(homeSource, /updateWorklogStatus/);
});
