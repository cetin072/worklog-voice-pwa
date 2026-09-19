import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJournalDateFromText,
  parseKoreanDateExpression,
  seoulDateParts,
} from "../netlify/shared/korean-date-core.mjs";

const RECORDED_AT="2026-09-19T08:00:00.000Z"; // 2026-09-19 17:00 KST

test("journal relative dates support past, today, and future",()=>{
  assert.equal(extractJournalDateFromText("어제 삼현 대표 미팅",RECORDED_AT).dateKey,"2026-09-18");
  assert.equal(extractJournalDateFromText("그제 계약서 전달",RECORDED_AT).dateKey,"2026-09-17");
  assert.equal(extractJournalDateFromText("그저께 보험사 통화",RECORDED_AT).dateKey,"2026-09-17");
  assert.equal(extractJournalDateFromText("오늘 견적서 정리",RECORDED_AT).dateKey,"2026-09-19");
  assert.equal(extractJournalDateFromText("내일 태장 방문",RECORDED_AT).dateKey,"2026-09-20");
});

test("journal supports previous, current, and next week weekdays",()=>{
  assert.equal(extractJournalDateFromText("지난주 화요일 미래원 회의",RECORDED_AT).dateKey,"2026-09-08");
  assert.equal(extractJournalDateFromText("이번주 금요일 서류 제출",RECORDED_AT).dateKey,"2026-09-18");
  assert.equal(extractJournalDateFromText("다음주 화요일 태장 방문",RECORDED_AT).dateKey,"2026-09-22");
});

test("지난 금요일 means the previous occurrence, not today when base is Friday",()=>{
  const friday="2026-09-18T03:00:00.000Z"; // 2026-09-18 12:00 KST Friday
  assert.equal(extractJournalDateFromText("지난 금요일 삼현 미팅",friday).dateKey,"2026-09-11");
});

test("journal month-day stays in the same calendar year even when it is already past",()=>{
  const result=extractJournalDateFromText("9월 10일 계약조건 설명",RECORDED_AT);
  assert.equal(result.dateKey,"2026-09-10");
  assert.equal(result.matched,true);
});

test("schedule policy still rolls a past month-day forward",()=>{
  const base=seoulDateParts(RECORDED_AT);
  const result=parseKoreanDateExpression("9월 10일 계약조건 설명",base,{policy:"schedule"});
  assert.equal(result?.key,"2027-09-10");
});

test("journal explicit future month-day stays in the same year",()=>{
  assert.equal(extractJournalDateFromText("12월 3일 태장 방문 예정",RECORDED_AT).dateKey,"2026-12-03");
});

test("journal defaults to the recording day when no explicit date is present",()=>{
  const result=extractJournalDateFromText("강대표가 계약 조건 다시 본다고 함",RECORDED_AT);
  assert.equal(result.dateKey,"2026-09-19");
  assert.equal(result.matched,false);
  assert.equal(result.ambiguous,false);
});

test("journal fails closed when multiple date signals conflict",()=>{
  const result=extractJournalDateFromText("어제 회의했고 내일 다시 연락",RECORDED_AT);
  assert.equal(result.matched,false);
  assert.equal(result.dateKey,"");
  assert.equal(result.ambiguous,true);
});

test("invalid explicit journal date is not silently converted to today",()=>{
  const result=extractJournalDateFromText("2월 30일 잘못된 기록",RECORDED_AT);
  assert.equal(result.matched,false);
  assert.equal(result.dateKey,"");
  assert.equal(result.ambiguous,true);
});
