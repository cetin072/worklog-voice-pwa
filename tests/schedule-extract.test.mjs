import test from "node:test";
import assert from "node:assert/strict";
import { extractScheduleFromText } from "../netlify/shared/schedule-extract.mjs";

const RECORDED_AT="2026-09-12T08:45:00.000Z"; // 2026-09-12 17:45 KST

test("extracts tomorrow afternoon time and removes schedule words",()=>{
  const result=extractScheduleFromText("내일 오후 3시에 범한메카텍 김대리에게 전화",RECORDED_AT);
  assert.equal(result.dueStart,"2026-09-13T15:00:00+09:00");
  assert.equal(result.text,"범한메카텍 김대리에게 전화");
  assert.equal(result.hasTime,true);
});

test("extracts explicit month day and minute",()=>{
  const result=extractScheduleFromText("9월 15일 오전 10시 30분에 회의 자료 전달",RECORDED_AT);
  assert.equal(result.dueStart,"2026-09-15T10:30:00+09:00");
  assert.equal(result.text,"회의 자료 전달");
});

test("extracts next week weekday",()=>{
  const result=extractScheduleFromText("다음 주 월요일 오후 2시에 계약서 검토",RECORDED_AT);
  assert.equal(result.dueStart,"2026-09-14T14:00:00+09:00");
  assert.equal(result.text,"계약서 검토");
});

test("extracts date only and keeps no time",()=>{
  const result=extractScheduleFromText("모레 세금계산서 발행",RECORDED_AT);
  assert.equal(result.dueStart,"2026-09-14");
  assert.equal(result.text,"세금계산서 발행");
  assert.equal(result.hasTime,false);
});

test("time only uses recording date",()=>{
  const result=extractScheduleFromText("오후 6시 20분에 대표에게 전화",RECORDED_AT);
  assert.equal(result.dueStart,"2026-09-12T18:20:00+09:00");
  assert.equal(result.text,"대표에게 전화");
});

test("does not guess ambiguous single-digit time without meridiem",()=>{
  const result=extractScheduleFromText("내일 3시에 업체 전화",RECORDED_AT);
  assert.equal(result.dueStart,"2026-09-13");
  assert.equal(result.text,"3시에 업체 전화");
});

test("keeps ordinary text unchanged when no schedule is present",()=>{
  const result=extractScheduleFromText("범한메카텍 견적서 확인",RECORDED_AT);
  assert.equal(result.matched,false);
  assert.equal(result.dueStart,"");
  assert.equal(result.text,"범한메카텍 견적서 확인");
});

test("treats night twelve as midnight",()=>{
  const result=extractScheduleFromText("내일 밤 12시에 배치 확인",RECORDED_AT);
  assert.equal(result.dueStart,"2026-09-13T00:00:00+09:00");
  assert.equal(result.text,"배치 확인");
});

test("preserves original text when separate schedule phrases could be combined incorrectly",()=>{
  const result=extractScheduleFromText("회의는 오후 3시에 하고 자료는 내일 보내기",RECORDED_AT);
  assert.equal(result.matched,false);
  assert.equal(result.dueStart,"");
  assert.equal(result.text,"회의는 오후 3시에 하고 자료는 내일 보내기");
});

test("preserves original text when more than one time is present",()=>{
  const result=extractScheduleFromText("내일 오후 3시에 A 전화 그리고 오후 4시에 B 전화",RECORDED_AT);
  assert.equal(result.matched,false);
  assert.equal(result.dueStart,"");
  assert.equal(result.text,"내일 오후 3시에 A 전화 그리고 오후 4시에 B 전화");
});
