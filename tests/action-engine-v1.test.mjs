import test from "node:test";
import assert from "node:assert/strict";
import { classifyWorklogAction, isTimedScheduleIntent } from "../netlify/shared/action-engine-v1.mjs";
import { extractScheduleFromText } from "../netlify/shared/schedule-extract.mjs";

const RECORDED_AT="2026-09-19T08:00:00.000Z"; // 2026-09-19 17:00 KST

test("clear timed meeting is Schedule",()=>{
  const transcript="내일 오후 2시에 삼현 미팅";
  const schedule=extractScheduleFromText(transcript,RECORDED_AT);
  const result=classifyWorklogAction({transcript,recordedAt:RECORDED_AT,schedule});
  assert.equal(result.kind,"schedule");
  assert.equal(result.actionKind,null);
  assert.equal(result.journalDate,"2026-09-20");
  assert.equal(result.needsReview,false);
  assert.equal(result.reason,"timed_event");
});

test("deadline action is Task rather than Schedule",()=>{
  const transcript="다음주 화요일까지 견적서 보내기";
  const schedule=extractScheduleFromText(transcript,RECORDED_AT);
  const result=classifyWorklogAction({transcript,recordedAt:RECORDED_AT,schedule});
  assert.equal(result.kind,"task");
  assert.equal(result.actionKind,"task");
  assert.equal(result.journalDate,"2026-09-22");
  assert.equal(result.reason,"deadline_action");
  assert.equal(result.needsReview,false);
});

test("reported fact with no user action is Note",()=>{
  const result=classifyWorklogAction({
    transcript:"강대표가 계약 조건 다시 검토한다고 함",
    recordedAt:RECORDED_AT,
  });
  assert.equal(result.kind,"note");
  assert.equal(result.actionKind,"note");
  assert.equal(result.journalDate,"2026-09-19");
  assert.equal(result.reason,"reported_fact");
  assert.equal(result.needsReview,false);
});

test("ambiguous action becomes Task plus review instead of silently becoming Note",()=>{
  const result=classifyWorklogAction({
    transcript:"강대표 내려오면 한번 보자",
    recordedAt:RECORDED_AT,
  });
  assert.equal(result.kind,"task");
  assert.equal(result.actionKind,"task");
  assert.equal(result.needsReview,true);
  assert.equal(result.reason,"ambiguous_action");
});

test("informational statement defaults to Note",()=>{
  const result=classifyWorklogAction({
    transcript:"삼현 담당자는 다음주 화요일 출장 예정",
    recordedAt:RECORDED_AT,
  });
  assert.equal(result.kind,"note");
  assert.equal(result.actionKind,"note");
  assert.equal(result.journalDate,"2026-09-22");
  assert.equal(result.needsReview,false);
});

test("manual 아이디어 is an authoritative Note hint",()=>{
  const result=classifyWorklogAction({
    transcript:"태장 홈페이지 첫 화면에 오늘 업무 요약을 넣어보면 좋겠다",
    recordedAt:RECORDED_AT,
    explicitType:"아이디어",
  });
  assert.equal(result.kind,"note");
  assert.equal(result.reason,"explicit_type_note");
  assert.equal(result.needsReview,false);
});

test("manual 할 일 is an authoritative Task hint",()=>{
  const result=classifyWorklogAction({
    transcript:"삼현 자료 정리",
    recordedAt:RECORDED_AT,
    explicitType:"할 일",
  });
  assert.equal(result.kind,"task");
  assert.equal(result.reason,"explicit_type_task");
});

test("timed deadline is still Task and not Calendar intent",()=>{
  const transcript="내일 오후 2시까지 견적서 보내";
  const schedule=extractScheduleFromText(transcript,RECORDED_AT);
  assert.equal(isTimedScheduleIntent({source:transcript,dueStart:schedule.dueStart}),false);
  const result=classifyWorklogAction({transcript,recordedAt:RECORDED_AT,schedule});
  assert.equal(result.kind,"task");
});

test("timed phone call is Calendar intent",()=>{
  const transcript="내일 오후 2시에 보험사 전화";
  const schedule=extractScheduleFromText(transcript,RECORDED_AT);
  assert.equal(isTimedScheduleIntent({source:transcript,dueStart:schedule.dueStart}),true);
  assert.equal(classifyWorklogAction({transcript,recordedAt:RECORDED_AT,schedule}).kind,"schedule");
});

test("ambiguous journal date keeps recording date and marks review",()=>{
  const result=classifyWorklogAction({
    transcript:"어제 확인한 내용 내일 다시 보자",
    recordedAt:RECORDED_AT,
  });
  assert.equal(result.kind,"task");
  assert.equal(result.journalDate,"2026-09-19");
  assert.equal(result.needsReview,true);
});
