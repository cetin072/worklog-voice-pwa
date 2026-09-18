import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mobileSearchSource = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');
const mobileSearchUi = fs.readFileSync('mobile/src/features/search/work-record-search.tsx', 'utf8');
const mobileHome = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const searchMigration = fs.readFileSync('supabase/migrations/20260916174500_integrated_search_query_guard.sql', 'utf8');

test('Mobile full-record search uses the existing RLS-protected RPC rather than filtering briefing data', () => {
  assert.match(mobileSearchSource, /searchMyWorkRecords/);
  assert.match(mobileSearchSource, /client\.rpc\('search_my_work_records'/);
  assert.match(mobileSearchSource, /p_query: normalizedQuery/);
  assert.match(mobileSearchSource, /p_limit: RECORD_SEARCH_PAGE_SIZE/);
  assert.match(mobileSearchSource, /p_offset: Math\.max\(0, sourceOffset\)/);
  assert.match(mobileSearchSource, /completed.*in_progress.*waiting.*needs_review/);
  assert.match(mobileSearchSource, /workspace isolation remains in the database/);
  assert.doesNotMatch(mobileSearchSource, /loadBriefing\([^)]*search/i);
  assert.match(searchMigration, /security invoker/i);
  assert.match(searchMigration, /grant execute on function public\.search_my_work_records\(text, integer, integer\) to authenticated, service_role/i);
});

test('Mobile full-record search exposes historical results, status filters, and source pagination', () => {
  assert.match(mobileSearchUi, /과거·완료 업무/);
  assert.match(mobileSearchUi, /업무명, 기관, 후속조치, 원문/);
  assert.match(mobileSearchUi, /in_progress[\s\S]*waiting[\s\S]*needs_review[\s\S]*completed/);
  assert.match(mobileSearchUi, /searchMyWorkRecords\(client, normalizedQuery, reset \? 0 : nextOffset, statuses\)/);
  assert.match(mobileSearchUi, /더 보기/);
  assert.match(mobileSearchUi, /이 조건의 결과가 다음 페이지에 있을 수 있습니다/);
  assert.match(mobileHome, /과거 기록 전체 검색/);
  assert.match(mobileHome, /setScreen\('recordSearch'\)/);
  assert.match(mobileHome, /<WorkRecordSearch client=\{client\} accessToken=\{session\.access_token\}/);
});

test('Mobile full-record search keeps server pagination and search query limits intact', () => {
  assert.match(mobileSearchSource, /const RECORD_SEARCH_PAGE_SIZE = 50/);
  assert.match(mobileSearchSource, /normalizedQuery\.length > 120/);
  assert.match(mobileSearchSource, /nextOffset: Math\.max\(0, sourceOffset\) \+ rows\.length/);
  assert.match(mobileSearchSource, /hasMore: rows\.length === RECORD_SEARCH_PAGE_SIZE/);
  assert.match(searchMigration, /greatest\(1, least\(coalesce\(p_limit, 20\), 50\)\)/);
  assert.match(searchMigration, /greatest\(0, least\(coalesce\(p_offset, 0\), 5000\)\)/);
});


test('Mobile search result can be expanded and edited through the existing worklog edit boundary', () => {
  assert.match(mobileSearchUi, /selectedId/);
  assert.match(mobileSearchUi, /openEditor/);
  assert.match(mobileSearchUi, /readWorklogDetails/);
  assert.match(mobileSearchUi, /updateWorklogDetails/);
  assert.match(mobileSearchUi, /이 업무 수정/);
  assert.match(mobileSearchUi, /검색 결과 업무명 수정/);
  assert.match(mobileSearchUi, /saveEditor/);
  assert.match(mobileSearchUi, /업무를 수정했습니다/);
  assert.match(mobileHome, /accessToken=\{session\.access_token\}/);
});

test('Mobile task editing selects due dates and times with the native picker instead of typing formats', () => {
  assert.match(mobileHome, /@react-native-community\/datetimepicker/);
  assert.match(mobileHome, /accessibilityLabel="수정할 날짜 선택"/);
  assert.match(mobileHome, /accessibilityLabel="수정할 시간 선택"/);
  assert.match(mobileHome, /<DateTimePicker value=\{selectedValue\} mode=\{pickerMode\}/);
  assert.match(mobileHome, /mode=\{pickerMode\}/);
  assert.match(mobileHome, /기한 없음으로 변경/);
  assert.doesNotMatch(mobileHome, /placeholder="YYYY-MM-DD"/);
  assert.doesNotMatch(mobileHome, /placeholder="HH:MM"/);
});
