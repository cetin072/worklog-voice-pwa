import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
const native=`export const Platform={OS:'android'};`;
const notifications=`let rows=[],gate=null;export const SchedulableTriggerInputTypes={DATE:'date'},AndroidImportance={DEFAULT:3};export async function getPermissionsAsync(){if(gate)await gate.promise;return{granted:true}};export async function setNotificationChannelAsync(){};export async function getAllScheduledNotificationsAsync(){return rows};export async function cancelScheduledNotificationAsync(id){rows=rows.filter(r=>r.identifier!==id)};export async function scheduleNotificationAsync(r){rows.push(r);return r.identifier};export function seed(r){rows=r};export function hold(){let release;const promise=new Promise(r=>release=r);gate={promise,release}};export function release(){gate.release();gate=null};`;
const url=s=>`data:text/javascript,${encodeURIComponent(s)}`;
register('./helpers/mobile-ts-loader.mjs',import.meta.url,{data:{mocks:{'react-native':url(native),'expo-notifications':url(notifications)}}});
const n=await import(url(notifications)),r=await import('../mobile/src/features/subscriptions/subscription-reminders.ts');
const sub={id:'s',name:'합성 보험',amountKrw:100000,cycle:'monthly',scope:'personal',billingAnchorDate:'2026-11-15',cancelDeadline:null,lastUsedDate:null,createdAt:null,sourceText:null};
const now=Date.parse('2026-11-09T00:00:00+09:00'),other={identifier:'schedule.other',content:{data:{owner:'schedule'}}};
test('납부 확인한 회차 알림 제거, 다음 회차 및 다른 알림 보존',async()=>{
 n.seed([other]);await r.syncSubscriptionReminders([sub],'2026-11-09',now,[{subscription_id:'s',due_date:'2026-11-15'}]);
 const rows=await n.getAllScheduledNotificationsAsync();assert.equal(rows.length,3);assert.ok(rows.includes(other));assert.equal(rows.some(r=>r.identifier.includes('2026-11-15')),false);
});
test('로그아웃과 늦은 권한 응답 경합 후 이전 계정 알림이 다시 예약되지 않음',async()=>{
 n.seed([other]);n.hold();const pending=r.syncSubscriptionReminders([sub],'2026-11-09',now);
 await new Promise(resolve=>setImmediate(resolve));const cleanup=r.cancelAllSubscriptionReminders();n.release();await Promise.all([pending,cleanup]);
 assert.deepEqual(await n.getAllScheduledNotificationsAsync(),[other]);
 assert.equal((await r.syncSubscriptionReminders([sub],'2026-11-09',now,[],()=>false)).status,'superseded');
});

test('구독 예약은 현재 계정을 기록하고 재시작 보존·다른 계정 전환 정리',async()=>{
 n.seed([other]);await r.syncSubscriptionReminders([sub],'2026-11-09',now,[],()=>true,'A');
 const count=(await n.getAllScheduledNotificationsAsync()).length;await r.reconcileSubscriptionReminderOwner('A',()=>true);assert.equal((await n.getAllScheduledNotificationsAsync()).length,count);
 await r.reconcileSubscriptionReminderOwner('B',()=>true);assert.deepEqual(await n.getAllScheduledNotificationsAsync(),[other]);
});
