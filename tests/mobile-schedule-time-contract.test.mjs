import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mobileHome = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const mobileApi = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');

test('Mobile schedule rows retain and format a timed startsAt value in Asia/Seoul', () => {
  assert.match(mobileApi, /startsAt\?: string/);
  assert.match(mobileHome, /function formatSchedule/);
  assert.match(mobileHome, /new Date\(schedule\.startsAt\)/);
  assert.match(mobileHome, /timeZone: 'Asia\/Seoul'/);
  assert.match(mobileHome, /hour: 'numeric'/);
  assert.match(mobileHome, /minute: '2-digit'/);
  assert.match(mobileHome, /formatSchedule\(schedule\)/);
});
