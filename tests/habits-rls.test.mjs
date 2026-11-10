import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',H='33333333-3333-4333-8333-333333333333';
let next=0;const req=()=>`44444444-4444-4444-8444-${String(++next).padStart(12,'0')}`;
test('습관 실제 DB: 하루 한 건·확인/취소·동시 수정 충돌·과거 보존·종료·RLS',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create schema worklog;grant usage on schema worklog to authenticated,anon;`);
  await db.exec(fs.readFileSync('supabase/migrations/20261109234334_habits_v1.sql','utf8'));
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${A}',false)`);
  const today=(await db.query("select ((now() at time zone 'Asia/Seoul')::date)::text as today_key")).rows[0].today_key;
  const call=async(command,version,id=req())=>(await db.query('select worklog.mutate_habit($1,$2,$3,$4) value',[H,id,version,JSON.stringify(command)])).rows[0].value;
  await call({op:'create',draft:{name:'독서',frequency:'weekly-target',target:3,weekdays:[],start_date:'2026-01-01'}},-1);
  const check={op:'check',day:today,checked:true},id=req(),first=await call(check,-1,id);
  for(let i=0;i<10;i++)assert.deepEqual(await call(check,-1,id),first);
  assert.equal((await db.query('select * from worklog.habit_checks')).rows.length,1);
  await assert.rejects(call({...check,checked:false},-1),/VERSION_CONFLICT/);
  assert.equal((await call({...check,checked:false},0)).checked,false);
  await assert.rejects(call({...check,day:'2026-01-01'},1),/INVALID_CHECK_DAY/);
  await db.query("insert into worklog.habit_checks(habit_id,day,checked) values($1,'2026-01-05',true)",[H]);
  assert.equal((await db.query('select * from worklog.habit_checks')).rows.length,2);
  await call({op:'end'},0);assert.equal((await db.query('select * from worklog.habit_checks')).rows.length,2);
  await assert.rejects(call(check,1),/HABIT_NOT_DUE/);
  await db.exec(`select set_config('request.jwt.claim.sub','${B}',false)`);
  assert.equal((await db.query('select * from worklog.habits')).rows.length,0);assert.equal((await db.query('select * from worklog.habit_checks')).rows.length,0);
  await assert.rejects(call(check,1),/HABIT_NOT_DUE/);
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from worklog.habits'),/permission denied/);
 }finally{await db.close();}
});
