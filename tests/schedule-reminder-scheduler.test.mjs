import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../netlify/shared/notification-scheduler.mjs',import.meta.url),'utf8');
test('기존 아침/오후 claim과 신규 일정 claim을 함께 유지한다',()=>{assert.match(source,/claimMorning/);assert.match(source,/claimAfternoon/);assert.match(source,/claimScheduleAdvance/);});
test('일정 claim은 schedule id/title/start를 필수 검증한다',()=>{assert.match(source,/schedule_id/);assert.match(source,/schedule_title/);assert.match(source,/schedule_starts_at/);});
