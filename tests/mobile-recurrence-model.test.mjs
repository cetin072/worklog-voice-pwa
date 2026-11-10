import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const m = await import('../mobile/src/features/recurring/recurrence-model.ts');
const rule = (patch={}) => ({kind:'weekly',anchor:'2026-11-06',interval:1,weekdays:[5],unit:'day',...patch});
const work = r => ({workRecordId:'w1',version:0,state:m.newRepeatState('청소',r)});
const dates = (w,from,to) => m.repeatOccurrences(w,from,to).map(r=>r.dueDate);
test('매주 금요일·2주 금요일·복수 요일·매일 계산, 90일 미리보기는 상태를 쓰지 않음',()=>{
 const w=work(rule());const before=JSON.stringify(w);
 assert.deepEqual(dates(w,'2026-11-01','2026-11-30'),['2026-11-06','2026-11-13','2026-11-20','2026-11-27']);
 assert.deepEqual(dates(work(rule({interval:2})),'2026-11-01','2026-11-30'),['2026-11-06','2026-11-20']);
 assert.deepEqual(dates(work(rule({weekdays:[1,5]})),'2026-11-06','2026-11-13'),['2026-11-06','2026-11-09','2026-11-13']);
 assert.equal(dates(work(rule({kind:'daily'})),'2026-11-06','2026-11-13').length,8);
 m.repeatOccurrences(w,'2026-11-01','2027-01-30');assert.equal(JSON.stringify(w),before);
});
test('매월31 말일 보정 후 복귀·윤년2/29와 연 반복',()=>{
 const w=work(rule({kind:'monthly',anchor:'2024-01-31'}));
 assert.deepEqual(dates(w,'2024-01-01','2024-05-31'),['2024-01-31','2024-02-29','2024-03-31','2024-04-30','2024-05-31']);
 const annual=work(rule({kind:'yearly',anchor:'2024-02-29'}));
 assert.deepEqual(dates(annual,'2025-02-01','2025-03-01'),['2025-02-28']);
 assert.deepEqual(dates(annual,'2028-02-01','2028-03-01'),['2028-02-29']);
});
test('8주 미완료와 다음 회차 독립, 미래 예정은 미완료 집계 제외',()=>{
 const rows=m.repeatOccurrences(work(rule({anchor:'2026-09-04'})),'2026-09-04','2026-10-30');
 const s=m.repeatSummary(rows,'2026-10-30');assert.equal(s.missed,8);assert.equal(s.nextDate,'2026-10-30');assert.equal(rows.filter(r=>r.dueDate<'2026-10-30').slice(-3).length,3);
});
test('완료 14일 후, 지연 완료 30일 후, 건너뜀 다음일 지정·Undo',()=>{
 const w=work(rule({kind:'after-completion',anchor:'2026-11-05',interval:30}));
 const row=m.repeatOccurrences(w,'2026-11-01','2026-12-31')[0];
 w.state.occurrences[row.key]={...row,status:'completed',completedOn:'2026-11-08'};
 assert.deepEqual(dates(w,'2026-11-01','2026-12-31'),['2026-11-05','2026-12-08']);
 delete w.state.occurrences[row.key];assert.deepEqual(dates(w,'2026-11-01','2026-12-31'),['2026-11-05']);
 w.state.occurrences[row.key]={...row,status:'skipped',completedOn:null};assert.equal(dates(w,'2026-11-01','2026-12-31').length,1);
 w.state.occurrences[row.key].nextDate='2026-11-20';assert.deepEqual(dates(w,'2026-11-01','2026-12-31'),['2026-11-05','2026-11-20']);
});
test('회차 날짜 이동은 키 유지·다른 월 규칙 불변, 중지/재개 미소급·종료 이력 보존',()=>{
 const w=work(rule({kind:'monthly',anchor:'2026-11-10'}));
 const row=m.repeatOccurrences(w,'2026-12-01','2026-12-31')[0];w.state.occurrences[row.key]={...row,dueDate:'2027-01-02'};
 assert.deepEqual(dates(w,'2026-12-01','2026-12-31'),[]);
 assert.deepEqual(dates(w,'2027-01-01','2027-01-31'),['2027-01-02','2027-01-10']);
 const a=work(rule());a.state.pauses=[{from:'2026-11-13',to:'2026-11-25'}];
 assert.deepEqual(dates(a,'2026-11-01','2026-11-30'),['2026-11-06','2026-11-27']);
 a.state.endedOn='2026-11-26';assert.deepEqual(dates(a,'2026-11-01','2026-12-31'),['2026-11-06']);
});

test('실제 완료 2주 후와 중지 기간 다음 예정·미래 전체 수정은 과거 불변',()=>{
 const w=work(rule({kind:'after-completion',anchor:'2026-11-05',interval:2,unit:'week'}));
 const row=m.repeatOccurrences(w,'2026-11-01','2026-12-31')[0];w.state.occurrences[row.key]={...row,status:'completed',completedOn:'2026-11-08'};
 assert.deepEqual(dates(w,'2026-11-01','2026-12-31'),['2026-11-05','2026-11-22']);
 w.state.pauses=[{from:'2026-11-20',to:'2026-11-25'}];assert.deepEqual(dates(w,'2026-11-01','2026-12-31'),['2026-11-05','2026-11-25']);
 const fixed=work(rule({kind:'monthly',anchor:'2026-11-10'}));fixed.state.revisions.push({version:2,from:'2026-12-01',title:'새 청소',time:'',rule:rule({kind:'monthly',anchor:'2026-12-15'})});
 assert.deepEqual(dates(fixed,'2026-11-01','2027-01-31'),['2026-11-10','2026-12-15','2027-01-15']);
});


test('이번 회차 시간만 변경하면 다음 회차 시간 불변·논리 키 보존',()=>{
 const w=work(rule());w.state.revisions[0].time='09:00';
 const row=m.repeatOccurrences(w,'2026-11-01','2026-11-30')[0];
 w.state.occurrences[row.key]={...row,time:'15:30'};
 const rows=m.repeatOccurrences(w,'2026-11-01','2026-11-30');
 assert.equal(rows[0].key,row.key);assert.equal(rows[0].time,'15:30');assert.equal(rows[1].time,'09:00');
});
