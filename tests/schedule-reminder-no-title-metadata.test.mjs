import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260917190500_schedule_advance_notification_v1.sql',import.meta.url),'utf8');
test('delivery metadata는 scheduleId만 저장한다',()=>assert.match(sql,/jsonb_build_object\('scheduleId',due\.id\)/));
