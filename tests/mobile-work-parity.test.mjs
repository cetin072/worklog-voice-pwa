import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const apiSource = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');
const homeSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const editSheetSource = fs.readFileSync('mobile/src/features/work/work-record-edit-sheet.tsx', 'utf8');

test('Mobile work status reuses the authenticated Data Core briefing mutation contract', () => {
  assert.match(apiSource, /updateWorklogStatus/);
  assert.match(apiSource, /\/api\/briefing-v2/);
  assert.match(apiSource, /recordId, status/);
  assert.match(apiSource, /authorization: `Bearer \$\{accessToken\}`/);
});

test('Mobile work parity exposes completion, undo, and one-tap editing from the home briefing', () => {
  assert.match(homeSource, /completeTaskInline/);
  assert.match(homeSource, /onComplete=\{\(\) => void completeTaskInline\(task\)\}/);
  assert.match(homeSource, /undoCompletedTask/);
  assert.match(homeSource, /실행 취소/);
  assert.match(homeSource, /updateWorklogStatus\(session\.access_token, task\.pageId, '완료'\)/);
  assert.match(homeSource, /openTaskEditor/);
  assert.match(homeSource, /WorkRecordEditSheet/);
  assert.match(editSheetSource, /브리핑 내용을 바로 고칩니다/);
  assert.match(editSheetSource, /selectTextOnFocus/);
  assert.match(homeSource, /updateWorklogDetails/);
  assert.match(apiSource, /\/api\/worklog-edit/);
  assert.match(apiSource, /action: 'read'/);
  assert.match(apiSource, /action: 'update'/);
  assert.match(homeSource, /업무 상세/);
  assert.match(homeSource, /상태 변경/);
});

test('Top-level work search remains directly accessible without a dedicated work tab', () => {
  assert.match(homeSource, /accessibilityLabel="과거 업무 검색"/);
  assert.match(homeSource, /setScreen\('recordSearch'\)/);
  assert.doesNotMatch(homeSource, /PrimaryNavigation/);
});


test('Inline work edit surfaces schedule reconciliation and refreshes Home for device Calendar sync', () => {
  assert.match(apiSource, /WorklogUpdateResult/);
  assert.match(apiSource, /scheduleUpdated\?: boolean/);
  assert.match(homeSource, /const result = await updateWorklogDetails/);
  assert.match(homeSource, /result\.scheduleUpdated/);
  assert.match(homeSource, /연결된 일정·캘린더·알림도 최신 상태로 맞춥니다/);
  assert.match(homeSource, /await refreshBriefing\(\)/);
});

test('Work edit sheet blocks stale typing during detail load and exposes retry in-place', () => {
  assert.match(homeSource, /setEditReady\(false\)/);
  assert.match(homeSource, /setEditLoading\(true\)/);
  assert.match(homeSource, /retryTaskEditor/);
  assert.match(editSheetSource, /editable=\{ready && !busy\}/);
  assert.match(editSheetSource, /!ready && !loading && onRetry/);
  assert.match(editSheetSource, /다시 불러오기/);
});
