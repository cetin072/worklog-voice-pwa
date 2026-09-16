import test from "node:test";
import assert from "node:assert/strict";
import {analyzeCaptureText} from "../netlify/shared/capture-analysis.mjs";

const recordedAt=new Date("2026-09-16T01:00:00Z");

test("capture analysis promotes explicit meeting time to ScheduleCandidate",()=>{
  const result=analyzeCaptureText("내일 오후 2시에 삼현 미팅",recordedAt);
  assert.equal(result.type,"CaptureAnalysis");
  assert.equal(result.sourceType,"capture");
  assert.equal(result.localOnlySource,true);
  assert.equal(result.candidates[0]?.type,"ScheduleCandidate");
  assert.equal(result.candidates[0]?.dueStart,"2026-09-17T14:00:00+09:00");
  assert.equal(result.candidates[0]?.requiresConfirmation,true);
});

test("capture analysis joins wrapped chat lines before schedule classification",()=>{
  const result=analyzeCaptureText("내일 오후 2시에\n삼현 미팅",recordedAt);
  assert.equal(result.candidates[0]?.type,"ScheduleCandidate");
  assert.equal(result.candidates[0]?.dueStart,"2026-09-17T14:00:00+09:00");
  assert.match(result.candidates[0]?.text||"",/삼현 미팅/);
});

test("standalone chat bubble timestamp does not override the actual appointment time",()=>{
  const result=analyzeCaptureText("오후 3:21\n내일 오후 2시에\n삼현 미팅",recordedAt);
  assert.equal(result.candidates[0]?.type,"ScheduleCandidate");
  assert.equal(result.candidates[0]?.dueStart,"2026-09-17T14:00:00+09:00");
  assert.doesNotMatch(result.candidates[0]?.text||"",/오후 3:21/);
});

test("capture analysis keeps deadline as TaskCandidate",()=>{
  const result=analyzeCaptureText("내일 오후 2시까지 견적서 보내",recordedAt);
  assert.equal(result.candidates[0]?.type,"TaskCandidate");
  assert.equal(result.candidates[0]?.dueStart,"2026-09-17T14:00:00+09:00");
});

test("wrapped deadline remains a task instead of becoming a ScheduleCandidate",()=>{
  const result=analyzeCaptureText("내일 오후 2시까지\n견적서 보내",recordedAt);
  assert.equal(result.candidates.some(item=>item.type==="ScheduleCandidate"),false);
  assert.equal(result.candidates.some(item=>item.type==="TaskCandidate"),true);
});

test("capture analysis finds simple action lines and falls back safely",()=>{
  const action=analyzeCaptureText("김대리에게 자료 보내줘",recordedAt);
  assert.equal(action.candidates[0]?.type,"TaskCandidate");
  const fallback=analyzeCaptureText("회의 관련 대화 내용입니다",recordedAt);
  assert.equal(fallback.candidates[0]?.reason,"capture_fallback");
});
