import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const rules=fs.readFileSync(new URL('../netlify/shared/schedule-defer-reminder.mjs',import.meta.url),'utf8');
test('공통 일정 판단 모듈은 DOM/window/serviceWorker에 의존하지 않는다',()=>{assert.doesNotMatch(rules,/\bwindow\b|\bdocument\b|serviceWorker/);assert.match(rules,/isScheduleReminderEligible/);});
