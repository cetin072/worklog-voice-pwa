import test from "node:test";
import assert from "node:assert/strict";
import { briefingV2Counts, classifyBriefingTasks } from "../netlify/shared/briefing-v2.mjs";

const TODAY="2026-09-12";

function task(overrides={}){
  return {
    pageId:"11111111-1111-1111-1111-111111111111",
    title:"업무",
    institution:"태장",
    status:"진행중",
    project:"",
    dueKey:"",
    followUp:"",
    editedAt:"2026-09-12T00:00:00.000Z",
    ...overrides
  };
}

test("기한 지난 업무는 상태와 무관하게 지난 것",()=>{
  const result=classifyBriefingTasks([
    task({dueKey:"2026-09-10"}),
    task({status:"대기",dueKey:"2026-09-11"})
  ],TODAY);
  assert.equal(result.overdue.length,2);
  assert.equal(result.overdue[0].daysOverdue,2);
  assert.equal(result.upcoming.length,0);
  assert.equal(result.undated.length,0);
});

test("오늘 기한 업무는 확인필요여도 오늘 할 일",()=>{
  const result=classifyBriefingTasks([task({status:"확인필요",dueKey:TODAY})],TODAY);
  assert.equal(result.today.length,1);
  assert.equal(result.undated.length,0);
});

test("미래 기한 업무는 상태와 무관하게 다가오는 업무",()=>{
  const result=classifyBriefingTasks([
    task({status:"대기",dueKey:"2026-09-15"}),
    task({status:"확인필요",dueKey:"2026-09-20"})
  ],TODAY);
  assert.equal(result.upcoming.length,2);
  assert.equal(result.upcoming[0].daysUntil,3);
});

test("기한이 없으면 상태와 무관하게 기한 없는 업무",()=>{
  const result=classifyBriefingTasks([
    task({status:"대기"}),
    task({status:"확인필요"}),
    task({followUp:"대표 보고"})
  ],TODAY);
  assert.equal(result.undated.length,3);
});

test("대기와 후속조치는 기본 구간이 아니라 보조 집계로 남는다",()=>{
  const result=classifyBriefingTasks([
    task({status:"대기",dueKey:"2026-09-10",followUp:"회신 확인"}),
    task({status:"확인필요",dueKey:TODAY}),
    task({status:"대기",dueKey:"2026-09-20"}),
    task({followUp:"대표 보고"})
  ],TODAY);
  const counts=briefingV2Counts(result);
  assert.equal(counts.waiting,2);
  assert.equal(counts.followUp,3);
  assert.deepEqual(
    [counts.overdue,counts.today,counts.upcoming,counts.undated],
    [1,1,1,1]
  );
});

test("완료 업무는 모든 V2 미완료 구역에서 제외",()=>{
  const result=classifyBriefingTasks([task({status:"완료",dueKey:"2026-09-01"})],TODAY);
  assert.deepEqual(briefingV2Counts(result),{
    overdue:0,today:0,upcoming:0,undated:0,waiting:0,followUp:0,other:0,total:0
  });
});

test("시스템 프로젝트는 제외",()=>{
  const result=classifyBriefingTasks([
    task({project:"SYSTEM_DAILY_BRIEFING",dueKey:"2026-09-01"}),
    task({project:"SYSTEM_SPLIT_SOURCE",status:"대기"}),
    task({project:"SYSTEM_TEST",status:"확인필요"})
  ],TODAY);
  assert.equal(result.totalOpen,0);
});

test("네 기본 구간 합계는 항상 미완료 total과 일치",()=>{
  const result=classifyBriefingTasks([
    task({title:"지난",dueKey:"2026-09-10"}),
    task({title:"오늘",dueKey:TODAY}),
    task({title:"다가옴",dueKey:"2026-09-13"}),
    task({title:"무기한"})
  ],TODAY);
  const counts=briefingV2Counts(result);
  assert.equal(counts.overdue+counts.today+counts.upcoming+counts.undated,counts.total);
  assert.equal(counts.total,4);
  assert.equal(counts.other,0);
});

test("지난 것은 오래된 기한부터, 다가오는 업무는 가까운 기한부터 정렬",()=>{
  const result=classifyBriefingTasks([
    task({title:"지난2",dueKey:"2026-09-11"}),
    task({title:"지난1",dueKey:"2026-09-08"}),
    task({title:"다가옴2",status:"대기",dueKey:"2026-09-20"}),
    task({title:"다가옴1",status:"진행중",dueKey:"2026-09-13"})
  ],TODAY);
  assert.deepEqual(result.overdue.map(item=>item.title),["지난1","지난2"]);
  assert.deepEqual(result.upcoming.map(item=>item.title),["다가옴1","다가옴2"]);
});

test("하나의 업무는 네 기본 구간 중 한 곳에만 들어간다",()=>{
  const result=classifyBriefingTasks([
    task({status:"대기",dueKey:"2026-09-10",followUp:"회신 확인"}),
    task({status:"확인필요",dueKey:TODAY,followUp:"확인"}),
    task({status:"대기",dueKey:"2026-09-18"}),
    task({status:"확인필요"})
  ],TODAY);
  const primary=[...result.overdue,...result.today,...result.upcoming,...result.undated];
  assert.equal(primary.length,4);
  assert.equal(new Set(primary.map(item=>item.pageId+item.title+item.dueKey+item.status)).size,4);
});
