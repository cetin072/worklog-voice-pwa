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
const reservation = [
  '서비스센터 알림톡', '채팅 종료', '알림톡 도착',
  '[서비스센터 예약 안내]', '■ 고객명: 예시 사용자', '고객번호: 1234567890',
  '■ 예약일: 2026년12월07일(월)', '방문시간: 09:30',
  '■ 대표번호: 000-000-0000', '※ 방문 시 신분증을 지참하시기 바랍니다.',
].join('\n');

test('a booking notice combines its date and colon time, using only the booking heading', () => {
  const expected = {
    kind: 'schedule', title: '서비스센터 예약 안내', date: '2026-12-07', time: '09:30',
    startsAt: '2026-12-07T09:30:00+09:00', description: '', reason: 'labeled_event',
    transcript: '서비스센터 예약 안내', status: '진행중', followUp: '',
  };
  assert.deepEqual(captureScheduleInput(reservation, now), expected);
  assert.deepEqual(captureScheduleInput(reservation
    .replace('예약일:', '예약 날짜：\n')
    .replace('방문시간: 09:30', '예약 시간：\n9 : 30'), now), expected);
});

test('an incomplete, conflicting, cancelled or past booking stays in review', () => {
  for (const text of [
    reservation.replace('방문시간: 09:30', ''),
    reservation.replace('방문시간: 09:30', '방문시간: 09:30\n예약 시간: 10:30'),
    reservation.replace('07일(월)', '07일(화)'),
    reservation.replace('방문시간: 09:30', '방문시간: 29:30'),
    reservation + '\n예약이 취소되었습니다.',
  ]) {
    const result = captureScheduleInput(text, now);
    assert.equal(result.kind, 'review');
    assert.equal(result.date, '');
    assert.equal(result.time, '');
  }
  assert.equal(captureScheduleInput(reservation, '2026-12-07T01:00:00Z').reason, 'past_event');
});

const cardNow = '2026-11-28T08:19:00Z';
const bookingCard = '예시 바버숍\n예약이 확정되었습니다\n내 예약은 네이버마이에서 찾을 수 있어요. 바로가기\n예시 바버숍\n11. 29. (일) 오후 1:00\n실장 예시\n놓치면 아까운 혜택!\n광고 업체 AD\n상품 13,900원\n광고 가격 3,500원';
test('compact confirmed booking uses the venue and weekday-checked Korean date, not the advert', () => {
  for (const text of [bookingCard, bookingCard.replace('(일) 오후', '(일)\n오후')]) {
    const result = captureScheduleInput(text, cardNow);
    assert.equal(result.kind, 'schedule');
    assert.equal(result.title, '예시 바버숍');
    assert.equal(result.startsAt, '2026-11-29T13:00:00+09:00');
    assert.equal(result.followUp, '');
  }
  const rollover = bookingCard.replace('11. 29. (일) 오후 1:00', '1. 2. (토) 오전 12:00');
  assert.equal(captureScheduleInput(rollover, '2026-12-31T03:00:00Z').startsAt, '2027-01-02T00:00:00+09:00');
});
test('compact cards never auto-save an unconfirmed, mismatched, multiple, or past appointment', () => {
  for (const text of [
    bookingCard.replace('예약이 확정되었습니다', '예약을 확인하세요'),
    bookingCard.replace('(일)', '(월)'),
    bookingCard.replace('11. 29.', '11. 31.'),
    bookingCard.replace('오후 1:00', '오후 13:00'),
    bookingCard.replace('실장 예시', '예약이 취소되었습니다'),
    bookingCard.replace('실장 예시', '예시 일정\n11. 29. (일) 오후 2:00'),
  ]) assert.equal(captureScheduleInput(text, cardNow).kind, 'review', text);
  assert.equal(captureScheduleInput(bookingCard, '2026-11-29T04:00:00Z').kind, 'review');
});

test('role-based candidates work with different confirmation words and date layouts', () => {
  for (const [text, start] of [
    ['방문 예약\n방문이 확정되었습니다.\n매장: 예시 공방\n방문일시: 2026-12-06 14:30\n스폰서 추천\n유료 서비스 12. 8. (화) 오후 3:00', '2026-12-06T14:30:00+09:00'],
    ['진료가 확정됐습니다\n병원: 예시 의원\n12월 6일 (일요일)\n오전 10시 15분', '2026-12-06T10:15:00+09:00'],
    ['상담 확정\n예시 상담실\n12/6 (일) 오후 12:00\n결제 일시: 11. 29. (일) 오후 1:00', '2026-12-06T12:00:00+09:00'],
  ]) assert.equal(captureScheduleInput(text, cardNow).startsAt, start, text);
});
test('only safe fields from one candidate become local hints; no write date or time is set', () => {
  const badDay = captureScheduleInput(bookingCard.replace('(일)', '(월)'), cardNow);
  assert.deepEqual(badDay.reviewHint, { date: '', time: '13:00' });
  const noClock = captureScheduleInput(bookingCard.replace(' 오후 1:00', ''), cardNow);
  assert.deepEqual(noClock.reviewHint, { date: '2026-11-29', time: '' });
  const noMeridiem = captureScheduleInput(bookingCard.replace('오후 1:00', '1:00'), cardNow);
  assert.deepEqual(noMeridiem.reviewHint, { date: '2026-11-29', time: '' });
  for (const result of [badDay, noClock, noMeridiem]) {
    assert.equal(result.kind, 'review');
    assert.equal(result.title, '예시 바버숍');
    assert.equal(result.date, '');
    assert.equal(result.time, '');
    assert.equal(result.startsAt, undefined);
    assert.equal(result.transcript, '캡처 일정 확인 필요');
  }
  for (const injected of ['예약이 취소되었습니다', '다른 업체\n11. 29. (일) 오후 4:00']) {
    const result = captureScheduleInput(bookingCard.replace('실장 예시', injected), cardNow);
    assert.equal(result.kind, 'review');
    assert.equal(result.reviewHint, undefined);
  }
});
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
test('labeled announcement uses the event time, with check-in and venue as details',()=>{
 const announcement='2026 지역 상생 포럼\n참가 신청이 접수되었습니다.\n■ 행사 일시:\n2026년 11월 16일(월) 14:00\n■ 등록 시간: 13:30부터\n■ 행사 장소: 시민회관 301호\n■ 주소: 중앙대로 100\n양식이 의심스러운가요? 보고서';
 const event=captureScheduleInput(announcement,now);
 assert.equal(event.kind,'schedule');
 assert.equal(event.title,'2026 지역 상생 포럼');
 assert.equal(event.startsAt,'2026-11-16T14:00:00+09:00');
 assert.equal(event.description,'시민회관 301호 · 주소: 중앙대로 100 · 등록 13:30부터');
 for(const text of [announcement+'\n행사가 취소되었습니다.',announcement+'\n행사 일시: 2026년 11월 17일 15:30',announcement+'\n다른 모임은 15:30',
   announcement.replace('16일(월)','16일(화)'),announcement.replace('16일(월)','31일'),announcement.replace('14:00','14:00~16:00'),
   announcement.replace('14:00','25:00'),announcement.replace('14:00',''),announcement.replace('2026년 11월 16일(월)','내일')]){
   const decision=captureScheduleInput(text,now);
   assert.equal(decision.kind,'review',text);
   assert.equal(decision.startsAt,undefined);
 }
 assert.equal(captureScheduleInput(announcement,'2026-11-16T06:00:00Z').reason,'past_event');
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
 let count=0;const nonce=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++count).padStart(12,'0')}`;
 let inbox=createCaptureInbox(storage,nonce);const image={hash:'d'.repeat(64),uri:'file:///private/capture'};
 const original=await inbox.receive(image,'alice');
 const decision=captureScheduleInput('회의 날짜를 나중에 확인',now);
 const cancelled={...original,decision,saved:{pageId:'old-record'},undone:true,details:{title:'수정한 방문',dueDate:'2099-11-05',dueTime:'13:00'}};
 await inbox.put(cancelled);
 assert.equal((await inbox.receive(image,'alice')).undone,true);
 await assert.rejects(inbox.restart(image.hash,'bob',original.requestId),/CAPTURE_ENTRY_MISSING/);
 const [a,b]=await Promise.all([inbox.restart(image.hash,'alice',original.requestId),inbox.restart(image.hash,'alice',original.requestId)]);
 assert.equal(a.requestId,b.requestId);assert.equal(a.requestId,original.requestId+'-raaaaaaaa-aaaa-4aaa-8aaa-000000000001');assert.equal(a.saved,undefined);assert.equal(a.undone,undefined);
 assert.deepEqual(a.restartDetails,cancelled.details);
 await assert.rejects(inbox.put(cancelled),/CAPTURE_REGISTRATION_CHANGED/);
 inbox=createCaptureInbox(storage,nonce);const recovered=await inbox.receive(image,'alice');assert.equal(recovered.requestId,a.requestId);assert.deepEqual(recovered.restartDetails,cancelled.details);
 await inbox.put({...recovered,saved:{pageId:'new-record'},undone:true});
 const next=await inbox.restart(image.hash,'alice',recovered.requestId);assert.equal(next.requestId,original.requestId+'-raaaaaaaa-aaaa-4aaa-8aaa-000000000002');
});

test('legacy QA counter receipts remain readable while new installations use distinct random request IDs',async()=>{
 const hash='e'.repeat(64),decision=captureScheduleInput('날짜 확인 후 방문',now);
 const row={hash,owner:'alice',requestId:`capture-${hash}-r3`,recordedAt:now,decision,saved:{pageId:'cancelled-old'},undone:true};
 const storage=()=>{let value=JSON.stringify([row]);return{getItem:async()=>value,setItem:async(_k,v)=>{value=v;}};};
 const a=createCaptureInbox(storage(),()=> 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001');
 const b=createCaptureInbox(storage(),()=> 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001');
 const aa=await a.restart(hash,'alice',row.requestId),bb=await b.restart(hash,'alice',row.requestId);
 assert.notEqual(aa.requestId,bb.requestId);assert.equal((await a.get(hash,'alice')).requestId,aa.requestId);
});

test('booking metadata between the venue and date cannot become the title', () => {
  for (const metadata of [
    '예약 상세', '인원 2명', '예약자 예시 사용자', '예약 상세 보기\n예약 인원: 2명',
  ]) {
    const result = captureScheduleInput(bookingCard.replace(
      '11. 29. (일)', metadata + '\n11. 29. (일)'
    ), cardNow);
    assert.equal(result.kind, 'schedule', metadata);
    assert.equal(result.title, '예시 바버숍', metadata);
    assert.equal(result.startsAt, '2026-11-29T13:00:00+09:00');
  }
  const labeled = captureScheduleInput(
    '예약이 확정되었습니다\n일반 안내\n매장: 예시 공방\n인원 2명\n11. 29. (일) 오후 1:00', cardNow
  );
  assert.equal(labeled.kind, 'schedule');
  assert.equal(labeled.title, '예시 공방');
});

test('a booking without one credible title offers only a future date and time in review', () => {
  for (const titleRows of ['', '예약 상세\n인원 2명\n', '예시 공방\n별관 공방\n',
    '매장: 예시 공방\n장소: 별관 공방\n']) {
    const text = '예약이 확정되었습니다\n' + titleRows + '11. 29. (일) 오후 1:00';
    const result = captureScheduleInput(text, cardNow);
    assert.equal(result.kind, 'review', titleRows);
    assert.notEqual(result.title, '인원 2명');
    assert.equal(result.date, '');
    assert.equal(result.time, '');
    assert.equal(result.startsAt, undefined);
    assert.deepEqual(result.reviewHint, { date: '2026-11-29', time: '13:00' });
    const past = captureScheduleInput(text, '2026-11-29T05:00:00Z');
    assert.equal(past.reason, 'past_event');
    assert.equal(past.reviewHint, undefined);
  }
});
