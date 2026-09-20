import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { collectDeviceSyncResult } = await import('../mobile/src/features/schedule/device-sync-result.ts');

test('raw native Calendar and notification errors never reach schedule UI copy', async () => {
  const result = await collectDeviceSyncResult({
    calendar: async () => { throw new TypeError('setPrototypeOf argument is not coercible to Object'); },
    reminders: async () => { throw new Error('native notification object exploded'); },
  });

  assert.equal(result.calendar.status, 'error');
  assert.equal(result.calendar.message, '캘린더 상태를 확인하지 못했습니다. 다시 확인해주세요.');
  assert.doesNotMatch(result.calendar.message, /setPrototypeOf|coercible|Object/);

  assert.equal(result.reminders.status, 'error');
  assert.equal(result.reminders.message, '알림 예약을 확인하지 못했습니다. 다시 확인해주세요.');
  assert.doesNotMatch(result.reminders.message, /native|exploded/);
});
