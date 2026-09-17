import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const doc=fs.readFileSync(new URL('../docs/SCHEDULE_DEFER_REMINDER_V1.md',import.meta.url),'utf8');
test('Production migration과 main merge는 명시 승인 전 금지',()=>{assert.match(doc,/Production Supabase 적용은 사용자 명시 승인 전 금지/);assert.match(doc,/main 병합도 사용자 명시 승인 전 금지/);});
