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

test("기한 지난 진행중은 지난 것",()=>{
  const result=classifyBriefingTasks([task({dueKey:"2026-09-10"})],TODAY);
  assert.equal(result.overdue.length,1);
  assert.equal(result.overdue[0].daysOverdue,2);
  assert.equal(result.waiting.length,0);
});

test("기한 지난 대기도 지난 것 우선이며 기다리는 것과 중복되지 않는다",()=>{
  const result=classifyBriefingTasks([task({status:"대기",dueKey:"2026-09-11"})],TODAY);
  assert.equal(result.overdue.length,1);
  assert.equal(result.waiting.length,0);
});

test("오늘 기한 확인필요는 오늘",()=>{
  const result=classifyBriefingTasks([task({status:"확인필요",dueKey:TODAY})],TODAY);
  assert.equal(result.today.length,1);
  assert.equal(result.followUp.length,0);
});

test("미래 기한 대기는 기다리는 것",()=>{
  const result=classifyBriefingTasks([task({status:"대기",dueKey:"2026-09-15"})],TODAY);
  assert.equal(result.waiting.length,1);
  assert.equal(result.waiting[0].daysUntil,3);
});

test("기한 없는 대기도 기다리는 것",()=>{
  const result=classifyBriefingTasks([task({status:"대기"})],TODAY);
  assert.equal(result.waiting.length,1);
});

test("후속조치가 있는 진행중은 후속조치 필요",()=>{
  const result=classifyBriefingTasks([task({followUp:"대표 보고"})],TODAY);
  assert.equal(result.followUp.length,1);
});

test("후속조치가 없어도 확인필요 상태는 후속조치 필요",()=>{
  const result=classifyBriefingTasks([task({status:"확인필요"})],TODAY);
  assert.equal(result.followUp.length,1);
});

test("완료 업무는 모든 V2 미완료 구역에서 제외",()=>{
  const result=classifyBriefingTasks([task({status:"완료",dueKey:"2026-09-01"})],TODAY);
  assert.deepEqual(briefingV2Counts(result),{
    overdue:0,today:0,waiting:0,followUp:0,other:0,total:0
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

test("분류 조건이 없는 진행중은 otherCount로 집계",()=>{
  const result=classifyBriefingTasks([task()],TODAY);
  assert.equal(result.otherCount,1);
  assert.equal(result.totalOpen,1);
});

test("지난 것은 오래된 기한부터, 대기는 가까운 미래 기한부터 정렬",()=>{
  const result=classifyBriefingTasks([
    task({title:"지난2",dueKey:"2026-09-11"}),
    task({title:"지난1",dueKey:"2026-09-08"}),
    task({title:"대기2",status:"대기",dueKey:"2026-09-20"}),
    task({title:"대기1",status:"대기",dueKey:"2026-09-13"}),
    task({title:"대기무기한",status:"대기"})
  ],TODAY);
  assert.deepEqual(result.overdue.map(item=>item.title),["지난1","지난2"]);
  assert.deepEqual(result.waiting.map(item=>item.title),["대기1","대기2","대기무기한"]);
});

test("하나의 업무는 한 구역에만 들어간다",()=>{
  const result=classifyBriefingTasks([
    task({status:"대기",dueKey:"2026-09-10",followUp:"회신 확인"}),
    task({status:"확인필요",dueKey:TODAY,followUp:"확인"})
  ],TODAY);
  const counts=briefingV2Counts(result);
  assert.deepEqual(counts,{overdue:1,today:1,waiting:0,followUp:0,other:0,total:2});
});
