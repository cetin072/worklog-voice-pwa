import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { reminderFailureMessage, confirmedSeoulInstant, savedReminderMessage } = await import('../mobile/src/features/schedule/reminder-feedback.ts');
test('nested native permission errors remain actionable after batch aggregation', () => {
  assert.match(reminderFailureMessage(new AggregateError([new Error('SCHEDULE_EXACT_ALARM')], 'pending')), /정확한 알람 권한/);
  assert.match(reminderFailureMessage(new AggregateError([new Error('알림 권한')], 'pending')), /알림 권한/);
});
test('server unavailable never becomes saved-device success', () => {
  assert.match(reminderFailureMessage({ message: 'PGRST202 schema cache' }), /서버 준비/);
  assert.match(savedReminderMessage([], 1), /미확인/);
  assert.match(savedReminderMessage([{ action: 'ignored' }], 1), /미확인/);
  assert.match(savedReminderMessage([{ action: 'scheduled' }], 2), /미확인/);
  assert.match(savedReminderMessage([{ action: 'scheduled' }], 1), /예약 확인/);
});
test('manual confirmation requires real future date and explicit time, fixed Korea timezone', () => {
  const now = Date.parse('2026-10-24T10:00:00+09:00');
  assert.equal(confirmedSeoulInstant('2026-10-25', '09:00', now), '2026-10-25T09:00:00+09:00');
  for (const [date,time] of [['2026-10-25',''],['','09:00'],['2026-02-30','09:00'],['2026-10-23','09:00'],['2026-10-25','25:00'],['2026-10-24','10:00']]) assert.throws(() => confirmedSeoulInstant(date,time,now), /TIME_/);
});
