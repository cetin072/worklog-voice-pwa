import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const voice = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const meetingLibrary = fs.readFileSync('mobile/src/features/voice/meeting-recording-library.tsx', 'utf8');
const meetingRepo = fs.readFileSync('mobile/src/features/voice/meeting-recordings.ts', 'utf8');
const meetingProvider = fs.readFileSync('mobile/src/features/voice/meeting-recording-provider.tsx', 'utf8');
const meetingBanner = fs.readFileSync('mobile/src/features/voice/meeting-recording-banner.tsx', 'utf8');
const search = fs.readFileSync('mobile/src/features/search/work-record-search.tsx', 'utf8');
const api = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');
const editSheet = fs.readFileSync('mobile/src/features/work/work-record-edit-sheet.tsx', 'utf8');

test('Visible feature gate keeps Quick Voice fail-closed and result-visible', () => {
  assert.match(voice, /전사 재시도 필요/);
  assert.match(voice, /음성은 보존했습니다/);
  assert.match(voice, /다시 전사/);
  assert.match(voice, /업무 직접 입력/);
  assert.match(voice, /Peak/);
  assert.match(voice, /RMS/);
  assert.match(voice, /일정 생성 완료/);
});

test('Visible feature gate keeps meeting recording inspectable after capture', () => {
  assert.match(voice, /MeetingRecordingLibrary/);
  assert.match(meetingProvider, /MeetingRecordingSession/);
  assert.match(meetingBanner, /진행 중인 회의 녹음으로 돌아가기/);
  assert.match(meetingRepo, /meeting-recordings-v1\.json/);
  assert.match(meetingLibrary, /최근 회의 녹음/);
  assert.match(meetingLibrary, /▶ 재생/);
  assert.match(meetingLibrary, /⏸ 일시정지/);
  assert.match(meetingLibrary, /15초/);
  assert.match(meetingLibrary, /삭제/);
  assert.match(meetingLibrary, /이름 바꾸기/);
});

test('Visible feature gate keeps direct input and schedule creation truth explicit', () => {
  assert.match(api, /scheduleCreated\?: boolean/);
  assert.match(home, /직접 입력 저장 결과/);
  assert.match(home, /방금 생성된 일정/);
  assert.match(home, /일정 생성 완료/);
  assert.match(home, /scheduleCreated/);
});

test('Visible feature gate keeps internal schedules visible without external Calendar state', () => {
  assert.match(home, /오늘과 다가오는 일정/);
  assert.match(home, /업무수첩 내부에 저장합니다/);
  assert.doesNotMatch(home, /CalendarConnection|scheduleSettings|Google\/휴대폰 Calendar/);
});

test('Visible feature gate keeps work completion, undo, editing and search editing reachable', () => {
  assert.match(home, /completeTaskInline/);
  assert.match(home, /undoCompletedTask/);
  assert.match(home, /WorkRecordEditSheet/);
  assert.match(editSheet, /KeyboardAvoidingView/);
  assert.match(home, /scheduleUpdated/);
  assert.match(search, /openEditor/);
  assert.match(search, /saveEditor/);
  assert.match(search, /updateWorklogDetails/);
});

test('Visible feature gate keeps auth/settings failures visually distinct from success', () => {
  assert.match(home, /messageTone/);
  assert.match(home, /messageError/);
  assert.match(home, /messageInfo/);
  assert.match(home, /confirmSignOut/);
  assert.match(home, /Alert\.alert/);
});
