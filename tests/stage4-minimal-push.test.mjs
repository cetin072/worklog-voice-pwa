import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildAfternoonPushPayload } from '../netlify/shared/afternoon-push-content.mjs';
import { buildMorningPushPayload } from '../netlify/shared/morning-push-content.mjs';
import { selectResurfaceTasks } from '../netlify/shared/resurface-engine.mjs';

const morning = readFileSync(new URL('../netlify/functions/morning-push.mts', import.meta.url), 'utf8');
const afternoon = readFileSync(new URL('../netlify/functions/afternoon-push.mts', import.meta.url), 'utf8');
const taskReminder = readFileSync(new URL('../mobile/src/features/work/task-reminder-actions.tsx', import.meta.url), 'utf8');
const localNotifications = readFileSync(new URL('../mobile/src/features/schedule/local-notifications.ts', import.meta.url), 'utf8');
const roadmap = readFileSync(new URL('../docs/ROADMAP_STAGE4_NEVER_MISS.md', import.meta.url), 'utf8');

test('minimal Push keeps no-send behavior for empty briefing candidates while app resurfacing handles explicit attention', () => {
  assert.equal(buildMorningPushPayload({ todayCount: 0, overdueCount: 0, scheduleCount: 0 }), null);
  assert.equal(buildAfternoonPushPayload({ todayCount: 0, overdueCount: 0 }), null);
  const focus = selectResurfaceTasks([{
    pageId: 'task-1', title: '계약서 확인', status: '진행중', actionKind: 'task', dueKey: '2026-10-01', nextAttentionAt: '2026-09-20T00:00:00.000Z',
  }], { now: '2026-09-20T00:00:00.000Z', today: '2026-09-20' });
  assert.deepEqual(focus.map((task) => [task.pageId, task.reason]), [['task-1', 'attention']]);
});

test('only the established Web/PWA automatic Push schedules remain, with no new Push provider', () => {
  assert.match(morning, /schedule:"30 23 \* \* \*"/);
  assert.match(afternoon, /schedule:"30 7 \* \* \*"/);
  assert.match(morning, /claimMorning/);
  assert.match(afternoon, /claimAfternoon/);
  assert.doesNotMatch(`${morning}\n${afternoon}`, /OneSignal|Firebase Admin|Pusher|Twilio/);
});

test('Task attention remains in the trusted record contract while durable native reminders stay Schedule-owned', () => {
  assert.match(taskReminder, /onAttention\(afterDays\(1\)\)/);
  assert.doesNotMatch(taskReminder, /scheduleReminder|expo-notifications|Local Notification/);
  assert.match(localNotifications, /data: \{ scheduleId, target: 'schedule'/);
  assert.match(localNotifications, /const CHANNEL_ID = 'worklog-schedule-reminders'/);
  assert.match(roadmap, /Task의 명시적 `다시 알림`은 `next_attention_at`과 앱 내부 재노출/);
});

