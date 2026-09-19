import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sheet = fs.readFileSync('mobile/src/features/work/work-record-edit-sheet.tsx', 'utf8');
const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const search = fs.readFileSync('mobile/src/features/search/work-record-search.tsx', 'utf8');

test('Stage 2 uses one keyboard-safe bottom edit sheet from both briefing and search', () => {
  assert.match(sheet, /<Modal/);
  assert.match(sheet, /<KeyboardAvoidingView/);
  assert.match(sheet, /justifyContent: 'flex-end'/);
  assert.match(home, /<WorkRecordEditSheet/);
  assert.match(search, /<WorkRecordEditSheet/);
  assert.doesNotMatch(home, /InlineTaskEditor/);
  assert.doesNotMatch(search, /placeholder="YYYY-MM-DD"/);
  assert.doesNotMatch(search, /placeholder="HH:MM"/);
});

test('Stage 2 prevents late detail reads from overwriting active typing', () => {
  assert.match(sheet, /const inputBlocked = loading \|\| saving/);
  assert.match(sheet, /editable=\{ready && !inputBlocked\}/);
  assert.match(sheet, /maxLength=\{160\}/);
  assert.match(sheet, /selectTextOnFocus/);
  assert.match(home, /setEditReady\(false\)/);
  assert.match(search, /setEditReady\(false\)/);
});

test('Stage 2 uses native touch date and time pickers with a clear no-due action', () => {
  assert.match(sheet, /@react-native-community\/datetimepicker/);
  assert.match(sheet, /accessibilityLabel="수정할 날짜 선택"/);
  assert.match(sheet, /accessibilityLabel="수정할 시간 선택"/);
  assert.match(sheet, /mode=\{pickerMode\}/);
  assert.match(sheet, /is24Hour/);
  assert.match(sheet, /기한 없음으로 변경/);
  assert.match(sheet, /시간 선택/);
});

test('Stage 2 keeps edit feedback local, retryable, and preserves the voice original', () => {
  assert.match(sheet, /accessibilityLiveRegion="polite"/);
  assert.match(sheet, /다시 불러오기/);
  assert.match(sheet, /음성 원문은 그대로 보존됩니다/);
  assert.match(home, /retryTaskEditor/);
  assert.match(search, /retryEditor/);
  assert.match(home, /setEditStatus\(messageOf\(nextError, '업무 수정에 실패했습니다\.'/);
  assert.match(search, /setEditStatus\(error instanceof Error \? error\.message : '업무 수정에 실패했습니다\.'/);
});
