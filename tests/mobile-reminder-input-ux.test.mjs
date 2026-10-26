import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sheet = fs.readFileSync('mobile/src/features/schedule/worklog-reminder-sheet.tsx', 'utf8');
const settings = fs.readFileSync('mobile/src/features/settings/reminder-settings.tsx', 'utf8');
const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const coordinator = fs.readFileSync('mobile/src/features/schedule/schedule-reminder-coordinator.ts', 'utf8');

test('manual reminder fallback reuses installed date and time picker instead of raw text', () => {
  assert.match(sheet, /@react-native-community\/datetimepicker/);
  assert.match(sheet, /accessibilityLabel="알림 날짜 선택"/);
  assert.match(sheet, /accessibilityLabel="알림 시간 선택"/);
  assert.doesNotMatch(sheet, /placeholder="YYYY-MM-DD"|placeholder="HH:mm/);
  assert.ok(sheet.includes('!schedule && (!date || !time)'));
  assert.ok(sheet.includes('confirmedSeoulInstant(date.trim(), time.trim())'));
});

test('settings explain why notification permission alone does not imply reservations', () => {
  assert.match(settings, /예약된 일정 알림 없음/);
  assert.match(settings, /날짜와 시작 시각이 확정된 미래 일정/);
});

test('voice and direct entry retain automatic post-save start alarm synchronization', () => {
  assert.match(home, /synchronizeSavedScheduleReminders\(saved, reminderGuard\)/);
  assert.match(coordinator, /offsetMinutes: 0/);
});

test('visible reminder actions are available directly on every home record type', () => {
  assert.match(home, /function ReminderShortcut/);
  assert.match(home, /function TaskRow\(\{ bucket, task, onOpen, onReminder/);
  assert.match(home, /function NoteRow\(\{ note, onEdit, onDelete, onAcknowledge, onReminder/);
  assert.match(home, /function ScheduleRows\(\{ schedules, empty, onReminder/);
  assert.match(home, /onReminder=\{\(\) => setReminderTarget\(\{ recordId: task\.pageId/);
  assert.match(home, /🔔 알림 상태 확인/);
});
test('editing a record tries a guarded automatic reminder but keeps save and notification outcomes separate', () => {
  assert.match(home, /synchronizeEditedWorklogReminder\(client, \{/);
  assert.match(home, /기록은 수정됐지만 알림은 미확인/);
  assert.match(home, /새 일정 알림을 이 휴대폰에 예약했습니다/);
  assert.match(sheet, /readWorklogDetails\(token, target\.recordId\)/);
  assert.match(sheet, /기존 기록의 날짜와 시간을 불러왔습니다/);
});
