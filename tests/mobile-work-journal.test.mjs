import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api=fs.readFileSync("mobile/src/platform/worklog-api.ts","utf8");
const home=fs.readFileSync("mobile/app/index.tsx","utf8");

test("mobile exposes a typed automatic work journal loader",()=>{
  assert.match(api,/export type WorkJournalDay/);
  assert.match(api,/schedules: BriefingSchedule\[\]/);
  assert.match(api,/completed: WorkJournalRecord\[\]/);
  assert.match(api,/notes: WorkJournalNote\[\]/);
  assert.match(api,/openTasks: WorkJournalRecord\[\]/);
  assert.match(api,/export async function loadWorkJournalDay/);
  assert.match(api,/api\/work-journal\?date=/);
  assert.match(api,/parseWorkJournalDay/);
});

test("journal entry lives in settings while header retains search/settings",()=>{
  const header=home.slice(home.indexOf('function HomeHeader('),home.indexOf('export default function HomeScreen'));
  const settings=home.slice(home.indexOf("{screen === 'settings' ?"),home.indexOf("{screen === 'patchNotes' ?"));
  assert.doesNotMatch(header,/업무일지|onOpenJournal/);
  assert.match(header,/accessibilityLabel="과거 업무 검색"/);
  assert.match(header,/accessibilityLabel="설정 열기"/);
  assert.match(settings,/title="업무일지" accessibilityLabel="업무일지 열기"[\s\S]*onPress=\{openJournal\}/);
  assert.match(home,/title="업무일지" onClose=\{\(\) => setScreen\('settings'\)\}/);
  assert.match(home,/setScreen\(screen === 'journal' \? 'settings' : 'home'\)/);
});

test("journal screen uses simple previous today next navigation rather than a monthly calendar",()=>{
  assert.match(home,/accessibilityLabel="이전 날짜 업무일지"/);
  assert.match(home,/accessibilityLabel="다음 날짜 업무일지"/);
  assert.match(home,/journalTarget === journalToday \? '오늘' : '오늘로'/);
  assert.match(home,/moveJournalDay\(-1\)/);
  assert.match(home,/moveJournalDay\(1\)/);
  assert.doesNotMatch(home,/react-native-calendars/);
});

test("journal renders the four approved sections and future open work is labeled 예정",()=>{
  assert.match(home,/📅 일정 · 미팅/);
  assert.match(home,/✓ 한 일/);
  assert.match(home,/📝 업무 중 확인사항/);
  assert.match(home,/journalIsFuture \? '○ 예정' : '○ 남은 업무'/);
  assert.match(home,/미래 날짜는 예정된 일정과 남은 업무를 미리 보여줍니다/);
});

test("journal is view-first and does not add a separate daily writing workflow",()=>{
  const start=home.indexOf("{screen === 'journal' ?");
  const end=home.indexOf("screen === 'recordSearch'",start);
  assert.ok(start>=0 && end>start);
  const journalScreen=home.slice(start,end);
  assert.doesNotMatch(journalScreen,/오늘 업무일지 작성/);
  assert.doesNotMatch(journalScreen,/TextInput/);
  assert.doesNotMatch(journalScreen,/업무 저장/);
});

test("journal date changes clear stale content and retry forces a fresh load",()=>{
  assert.match(home,/setJournal\(null\);[\s\S]*setJournalBusy\(true\)/);
  assert.match(home,/\[screen, journalDate, journalReloadKey, session\?\.access_token\]/);
  assert.match(home,/setJournalReloadKey\(\(value\) => value \+ 1\)/);
});

test("journal row presentation is read-only and reuses compact work typography",()=>{
  assert.match(home,/function JournalRecordRows/);
  assert.match(home,/function JournalNoteRows/);
  assert.match(home,/function JournalScheduleRows/);
  assert.match(home,/styles\.taskTitle/);
  assert.match(home,/styles\.taskMeta/);
});
