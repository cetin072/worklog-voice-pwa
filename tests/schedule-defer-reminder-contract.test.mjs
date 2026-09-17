import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const migration=fs.readFileSync(new URL('../supabase/migrations/20260917190000_schedule_defer_reminder_v1.sql',import.meta.url),'utf8');
const notify=fs.readFileSync(new URL('../supabase/migrations/20260917190500_schedule_advance_notification_v1.sql',import.meta.url),'utf8');
const fn=fs.readFileSync(new URL('../netlify/functions/schedule-advance-push.mts',import.meta.url),'utf8');
test('미루기는 원래 일정 이력을 보존하고 새 30분 알림을 재계산한다',()=>{assert.match(migration,/schedule_defer_history/);assert.match(migration,/previous_starts_at/);assert.match(migration,/p_new_starts_at-interval '30 minutes'/);});
test('일정 알림은 완료/종일/과거 일정을 제외하고 5분 창만 claim한다',()=>{assert.match(notify,/all_day=false/);assert.match(notify,/status in \('confirmed','tentative'\)/);assert.match(notify,/p_now-interval '5 minutes'/);assert.match(notify,/s\.starts_at > p_now/);});
test('일정 알림은 schedule/subscription 단위로 중복 방지한다',()=>assert.match(notify,/notification_schedule_advance_unique/));
test('스케줄 함수는 5분마다 공통 claim을 실행한다',()=>{assert.match(fn,/claimScheduleAdvance/);assert.match(fn,/schedule:'\*\/5 \* \* \* \*'/);});
