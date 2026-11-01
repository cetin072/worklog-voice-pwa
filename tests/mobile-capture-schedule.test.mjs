import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { captureScheduleInput } from '../netlify/shared/capture-schedule-input.mjs';
import { extractScheduleFromText } from '../netlify/shared/schedule-extract.mjs';
import { classifyWorklogAction } from '../netlify/shared/action-engine-v1.mjs';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createCaptureInbox } = await import('../mobile/src/features/capture/capture-inbox.ts');
const now = '2026-10-31T00:00:00Z';
test('single explicit appointment becomes one canonical existing-core schedule', () => {
  const value = captureScheduleInput('2026년 11월 3일 오후 3시 김해 회사에서 회의합니다.\n오전 9:10', now);
  assert.equal(value.kind,'schedule');assert.equal(value.date,'2026-11-03');assert.equal(value.time,'15:00');
  const parsed = extractScheduleFromText(value.transcript,now);
  assert.equal(parsed.dueStart,'2026-11-03T15:00:00+09:00');
  assert.equal(classifyWorklogAction({transcript:value.transcript,recordedAt:now}).kind,'schedule');
});
test('relative day uses chat date, never capture date or message clock', () => {
  const value=captureScheduleInput('2026년 11월 2일 월요일\n오후 11:30\n내일 오후 3시 회사에서 회의',now);
  assert.equal(value.kind,'schedule');assert.equal(value.date,'2026-11-03');assert.equal(value.time,'15:00');
  assert.equal(captureScheduleInput('오후 11:30\n내일 오후 3시 회의',now).kind,'review');
});
test('redundant afternoon with a 24-hour clock is normalized without guessing the conversation date',()=>{
 const value=captureScheduleInput('2026년 11월 3일 오후 13시 거래처 방문',now);
 assert.equal(value.kind,'schedule');assert.equal(value.time,'13:00');
 assert.equal(extractScheduleFromText(value.transcript,now).dueStart,'2026-11-03T13:00:00+09:00');
 assert.equal(captureScheduleInput('오늘 오후 13시 거래처 방문',now).kind,'review');
 assert.equal(captureScheduleInput('2026년 11월 3일 오전 13시 거래처 방문',now).kind,'review');
});
test('unsafe conversations save a review record without scheduling their dates', () => {
  for (const text of ['11월 3일 오후 3시 회의','회의 날짜는 나중에 정해요','2026년 11월 2일 월요일\n내일 오후 3시 회의','2026년 10월 20일 화요일\n내일 오후 3시 회의',
    '2026년 15월 3일 오후 3시 회의', '2026년 11월 3일 오후 3시 회의 없음', '2026년 11월 3일 오후 3시 회의 취소','2026년 11월 3일 오후 3시 회의에서 11월 4일로 변경',
    '2026년 11월 3일 오후 3시 회의\n11월 4일 오후 4시 방문', '2026년 11월 3일 3시 회의',
    '2026년 11월 3일 오후 3시 회의 어때요?', '2026년 11월 1일 일요일\n2026년 11월 2일 월요일\n내일 오후 3시 회의']) {
    const value=captureScheduleInput(text,now);assert.equal(value.kind,'review',text);
    assert.equal(value.status,'확인필요');assert.equal(extractScheduleFromText(value.transcript,now).matched,false);
  }
  assert.throws(()=>captureScheduleInput(' \n '),/CAPTURE_NO_TEXT/);
  const unfamiliar = captureScheduleInput('서류 초안을 챙겨주세요',now);
  assert.equal(unfamiliar.kind,'review');assert.equal(unfamiliar.followUp,'서류 초안을 챙겨주세요');
});
test('same bytes concurrent/restarted retry keeps request ID and saved receipt; owners stay isolated', async () => {
  const data=new Map();const storage={getItem:async k=>data.get(k)||null,setItem:async(k,v)=>{data.set(k,v);}};
  let inbox=createCaptureInbox(storage);const image={hash:'a'.repeat(64),uri:'file:///private/image'};
  const [a,b]=await Promise.all([inbox.receive(image,'alice'),inbox.receive(image,'alice')]);
  assert.equal(a.requestId,b.requestId);assert.equal(JSON.parse([...data.values()][0]).length,1);
  await inbox.put({...a,saved:{pageId:'record-a',scheduleId:'schedule-a'}});
  inbox=createCaptureInbox(storage);assert.equal((await inbox.receive(image,'alice')).saved.pageId,'record-a');
  assert.equal((await inbox.receive(image,'bob')).saved,undefined);assert.equal(await inbox.pending('alice'),null);
  await inbox.put({...await inbox.get(image.hash,'alice'),undone:true});
  assert.equal((await inbox.receive(image,'alice')).undone,true,'re-sharing undone image cannot recreate schedule');
});
test('login claims anonymous pending work once, never another signed-in account entry',async()=>{
 const data=new Map(),storage={getItem:async k=>data.get(k)||null,setItem:async(k,v)=>data.set(k,v)};
 const inbox=createCaptureInbox(storage),image={hash:'b'.repeat(64),uri:'file:///private/pending'};
 await inbox.receive(image,null);const claimed=await inbox.claim(image.hash,'alice');assert.equal(claimed.owner,'alice');
 assert.equal(await inbox.pending(null),null);assert.equal(await inbox.get(image.hash,'bob'),null);
});
test('failed local persistence is not treated as accepted or successful',async()=>{
 const inbox=createCaptureInbox({getItem:async()=>null,setItem:async()=>{throw Error('disk');}});
 await assert.rejects(inbox.receive({hash:'c'.repeat(64),uri:'file:///private/pending'},null),/disk/);
});
test('native config keeps QA and production identity while registering only single images',()=>{
 const cfg=JSON.parse(readFileSync('mobile/app.json','utf8')).expo;
 const share=cfg.plugins.find(x=>Array.isArray(x)&&x[0]==='expo-sharing')[1];
 assert.deepEqual(share.android.singleShareMimeTypes,['image/*']);assert.deepEqual(share.android.multipleShareMimeTypes,[]);
 const ocr=cfg.plugins.find(x=>Array.isArray(x)&&x[0]==='rn-mlkit-ocr')[1];assert.equal(ocr.ocrUseBundled,true);assert.ok(ocr.ocrModels.includes('korean'));
 const source=readFileSync('mobile/app/+native-intent.ts','utf8');
 assert.match(source,/hostname === 'expo-sharing'/);assert.match(source,/return path/);
});

test('explicit restart preserves edited fields, advances the request only once, and rejects stale receipts',async()=>{
 const data=new Map(),storage={getItem:async k=>data.get(k)||null,setItem:async(k,v)=>data.set(k,v)};
 let inbox=createCaptureInbox(storage);const image={hash:'d'.repeat(64),uri:'file:///private/capture'};
 const original=await inbox.receive(image,'alice');
 const decision=captureScheduleInput('회의 날짜를 나중에 확인',now);
 const cancelled={...original,decision,saved:{pageId:'old-record'},undone:true,details:{title:'수정한 방문',dueDate:'2099-11-05',dueTime:'13:00'}};
 await inbox.put(cancelled);
 assert.equal((await inbox.receive(image,'alice')).undone,true);
 await assert.rejects(inbox.restart(image.hash,'bob',original.requestId),/CAPTURE_ENTRY_MISSING/);
 const [a,b]=await Promise.all([inbox.restart(image.hash,'alice',original.requestId),inbox.restart(image.hash,'alice',original.requestId)]);
 assert.equal(a.requestId,b.requestId);assert.equal(a.requestId,original.requestId+'-r1');assert.equal(a.saved,undefined);assert.equal(a.undone,undefined);
 assert.deepEqual(a.restartDetails,cancelled.details);
 await assert.rejects(inbox.put(cancelled),/CAPTURE_REGISTRATION_CHANGED/);
 inbox=createCaptureInbox(storage);const recovered=await inbox.receive(image,'alice');assert.equal(recovered.requestId,a.requestId);assert.deepEqual(recovered.restartDetails,cancelled.details);
 await inbox.put({...recovered,saved:{pageId:'new-record'},undone:true});
 const next=await inbox.restart(image.hash,'alice',recovered.requestId);assert.equal(next.requestId,original.requestId+'-r2');
});
