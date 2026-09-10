import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKakaoBriefingMessages,
  deliverRemainingMessages,
  enrichBriefingStatuses,
  idempotencyHit,
  isFreshBriefingAt,
  isKakaoManualCooldown,
  isValidClientRequestId,
  kakaoDeliveryDecision,
  kakaoRunRecord,
  parseBriefingSnapshot,
  pageBelongsToDataSource,
  preservedQuickBriefingPeriod,
  quickTaskRank,
  sanitizeBriefingSnapshot,
  seoulDateFromRecordedAt
} from "../netlify/shared/core-logic.mjs";

test("worklog clientRequestId accepts only the server idempotency format",()=>{
  assert.equal(isValidClientRequestId("12345678-1234-1234-1234-123456789012"),true);
  assert.equal(isValidClientRequestId("too-short"),false);
  assert.equal(isValidClientRequestId("x".repeat(101)),false);
  assert.equal(isValidClientRequestId("bad id with spaces"),false);
});

test("worklog idempotency hit returns the cached page without creating another page",()=>{
  const first={pageId:"page-1",url:"https://notion.so/page-1",mode:"owner"};
  assert.deepEqual(idempotencyHit(first,"personal"),{...first,deduped:true});
  assert.equal(idempotencyHit(null,"owner"),null);
  assert.equal(idempotencyHit({pageId:""},"owner"),null);
  assert.equal(idempotencyHit(undefined,"owner"),null);
});

test("worklog invalid recordedAt falls back to the current Seoul date",()=>{
  const now=new Date("2026-09-10T03:00:00.000Z");
  assert.equal(seoulDateFromRecordedAt("not-a-date",now),"2026-09-10");
  assert.equal(seoulDateFromRecordedAt("2026-09-09T16:00:00.000Z",now),"2026-09-10");
});

test("briefing parses BRIEFING_V1 rows and rejects invalid snapshots",()=>{
  const parsed=parseBriefingSnapshot("BRIEFING_V1\ngeneratedAt=2026-09-10T08:00:00+09:00\nperiod=오전 8시\nTOP|계약 확인|오늘 기한|태장|abc\nTODAY|회의|9/10\nUPCOMING|보고|9/12\nCHECK|견적 확인");
  assert.equal(parsed.period,"오전 8시");
  assert.equal(parsed.top[0].title,"계약 확인");
  assert.equal(parsed.today[0].when,"9/10");
  assert.equal(parsed.upcoming[0].title,"보고");
  assert.equal(parseBriefingSnapshot("not a briefing"),null);
});

test("briefing sanitization limits TOP, schedules, and checking rows",()=>{
  const many=Array.from({length:12},(_,index)=>({title:`업무 ${index}`,when:`9/${index+1}`}));
  const result=sanitizeBriefingSnapshot({top:many,today:many,upcoming:many,checking:many.map(item=>item.title)});
  assert.equal(result.top.length,10);
  assert.equal(result.today.length,5);
  assert.equal(result.upcoming.length,5);
  assert.equal(result.checking.length,5);
});

test("quick briefing ranks overdue and imminent due dates before status-only tasks",()=>{
  const diff=(_today,due)=>({overdue:-1,today:0,soon:2,later:8}[due]);
  assert.equal(quickTaskRank({dueKey:"overdue"},"today",diff),0);
  assert.equal(quickTaskRank({dueKey:"today"},"today",diff),1);
  assert.equal(quickTaskRank({status:"확인필요"},"today",diff),5);
  assert.equal(quickTaskRank({status:"대기"},"today",diff),7);
});

test("quick update preserves only today's scheduled briefing period",()=>{
  const periods=new Set(["오전 8시","오후 12시 30분","오후 6시"]);
  assert.equal(preservedQuickBriefingPeriod({generatedDate:"2026-09-10",period:"오후 6시"},"2026-09-10",periods),"오후 6시");
  assert.equal(preservedQuickBriefingPeriod({generatedDate:"2026-09-09",period:"오후 6시"},"2026-09-10",periods),"빠른 업데이트");
  assert.equal(preservedQuickBriefingPeriod({generatedDate:"2026-09-10",period:"임의"},"2026-09-10",periods),"빠른 업데이트");
});

test("briefing status enrichment marks invalid IDs and lookup failures without failing other rows",async()=>{
  const valid=id=>id==="good" || id==="bad";
  const result=await enrichBriefingStatuses([{pageId:"good"},{pageId:"bad"},{pageId:"invalid"}],async id=>{
    if(id==="bad") throw new Error("Notion unavailable");
    return "진행중";
  },valid);
  assert.deepEqual(result,[
    {pageId:"good",status:"진행중",statusError:false},
    {pageId:"bad",status:"",statusError:true},
    {pageId:"invalid",status:"",statusError:true}
  ]);
});

test("briefing status updates reject pages outside the connected data source",()=>{
  assert.equal(pageBelongsToDataSource("aabbccdd-eeff-0011-2233-445566778899","aabbccddeeff00112233445566778899"),true);
  assert.equal(pageBelongsToDataSource("other-source","aabbccdd"),false);
});

test("Kakao delivery rejects period mismatch, stale briefings, and duplicates",()=>{
  const now=Date.parse("2026-09-10T00:00:00.000Z");
  assert.equal(kakaoDeliveryDecision({expectedPeriod:"오전 8시",period:"오후 6시"}),"period-mismatch");
  assert.equal(kakaoDeliveryDecision({requireFresh:true,generatedAt:"2026-09-09T00:00:00.000Z",now}),"stale");
  assert.equal(kakaoDeliveryDecision({alreadyDelivered:true}),"duplicate");
  assert.equal(kakaoDeliveryDecision({expectedPeriod:"오전 8시",period:"오전 8시",requireFresh:true,generatedAt:"2026-09-09T23:30:00.000Z",now}),"send");
  assert.equal(isFreshBriefingAt("2026-09-09T21:00:00.000Z",now),false);
});

test("Kakao resume sends only remaining messages after a partial delivery",async()=>{
  const sent=[];
  const progress=[];
  const completed=await deliverRemainingMessages(["one","two","three"],1,async message=>{sent.push(message);},async index=>{progress.push(index);});
  assert.equal(completed,3);
  assert.deepEqual(sent,["two","three"]);
  assert.deepEqual(progress,[2,3]);
});

test("Kakao automatic run records retain sent, skipped, and failed outcomes",()=>{
  const briefing={period:"오전 8시",generatedAt:"2026-09-10T08:00:00+09:00"};
  const now=new Date("2026-09-10T00:00:00.000Z");
  assert.equal(kakaoRunRecord("sent","sent",briefing,2,now).messageCount,2);
  assert.equal(kakaoRunRecord("skipped","stale",briefing,0,now).reason,"stale");
  assert.equal(kakaoRunRecord("failed","KAKAO_SEND_FAILED",briefing,0,now).status,"failed");
});

test("Kakao manual send cooldown lasts 30 seconds",()=>{
  const now=Date.parse("2026-09-10T00:00:00.000Z");
  assert.equal(isKakaoManualCooldown(now-29_999,now),true);
  assert.equal(isKakaoManualCooldown(now-30_000,now),false);
});

test("Kakao message packing keeps each generated message within the 200-character API limit",()=>{
  const messages=buildKakaoBriefingMessages({period:"오전 8시",top:[{title:"가".repeat(260),note:"나".repeat(260)}]});
  assert.ok(messages.length>1);
  assert.ok(messages.every(message=>message.length<=200));
});

test("Kakao briefing preserves a blank line between TOP and today's schedule",()=>{
  const messages=buildKakaoBriefingMessages({
    period:"오전 8시",
    top:[{title:"계약 확인"}],
    today:[{when:"9/10",title:"회의"}]
  });
  assert.equal(messages.length,1);
  assert.equal(messages[0],"📋 오전 8시 브리핑\n📌 우선 업무\n1. 계약 확인\n\n📅 오늘 일정\n- 9/10 회의");
});

test("Kakao briefing preserves section separators for upcoming and checking",()=>{
  const messages=buildKakaoBriefingMessages({
    period:"오후 6시",
    top:[{title:"오늘 마감"}],
    upcoming:[{when:"9/12",title:"보고"}],
    checking:["견적 확인"]
  });
  assert.equal(messages.length,1);
  assert.equal(messages[0],"📋 오후 6시 브리핑\n📌 우선 업무\n1. 오늘 마감\n\n🗓 다가오는 일정\n- 9/12 보고\n\n🔎 확인 필요\n- 견적 확인");
});

test("Kakao briefing ignores falsy schedule entries instead of emitting empty sections",()=>{
  const messages=buildKakaoBriefingMessages({
    period:"오전 8시",
    top:[{title:"업무"}],
    today:[null,false],
    upcoming:[null],
    checking:["",null,false]
  });
  assert.equal(messages.length,1);
  assert.equal(messages[0],"📋 오전 8시 브리핑\n📌 우선 업무\n1. 업무");
  assert.equal(messages[0].includes("오늘 일정"),false);
  assert.equal(messages[0].includes("다가오는 일정"),false);
  assert.equal(messages[0].includes("확인 필요"),false);
});

test("Kakao long multi-section messages preserve the API limit after section separation",()=>{
  const messages=buildKakaoBriefingMessages({
    period:"오후 12시 30분",
    top:Array.from({length:10},(_,index)=>({title:`긴 업무 ${index+1} ${"가".repeat(45)}`,institution:"태장"})),
    today:[{when:"9/10",title:"오늘 일정"}],
    upcoming:[{when:"9/12",title:"다가오는 일정"}],
    checking:["확인 필요 업무"]
  });
  assert.ok(messages.length>1);
  assert.ok(messages.every(message=>message.length<=200));
});
