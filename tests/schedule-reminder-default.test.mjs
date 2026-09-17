import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260917190500_schedule_advance_notification_v1.sql',import.meta.url),'utf8');
test('기존 reminder_at 없는 일정도 starts_at 30분 전을 기본값으로 사용한다',()=>assert.match(sql,/coalesce\(s\.reminder_at,s\.starts_at-interval '30 minutes'\)/));
