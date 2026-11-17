import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1), B=id(2), WA=id(3), WB=id(4), T=id(5), N=id(6), D=id(7), OTHER=id(8), S=id(9), R=id(10), F=id(11), CHILD=id(12), FOREIGN=id(13);
const sql = path => fs.readFileSync(path,'utf8').replaceAll('public.', 'worklog.').replaceAll('\nas $\n', () => '\nas $$\n').replaceAll('\n$;', () => '\n$$;');
test('personal folders SQL: nesting, move, RLS, canonical completion/Undo, persistence, due/Schedule independence', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema worklog;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');
   grant usage on schema auth,worklog to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
  // Use real Data Core tables/RLS and existing completion/journal logic, with the
  // deployed namespace mapping. No production or hosted test rows are touched.
  await db.exec(sql('supabase/schemas/01_data_core_v1.sql'));
  const journalState=sql('supabase/migrations/20260919083000_stage3_action_journal_contract.sql');
  await db.exec(journalState.slice(journalState.indexOf('create or replace function'),journalState.indexOf('create index')));
  await db.exec(sql('supabase/migrations/20260919120000_stage3_auto_work_journal.sql'));
  await db.exec(`create table worklog.repeating_work(work_record_id uuid primary key);grant select on worklog.repeating_work to authenticated;
   insert into worklog.workspaces(id,name,owner_user_id,created_by_user_id) values('${WA}','A','${A}','${A}'),('${WB}','B','${B}','${B}');
   insert into worklog.workspace_members(workspace_id,user_id,role) values('${WA}','${A}','owner'),('${WB}','${B}','owner');
   insert into worklog.work_records(id,workspace_id,created_by_user_id,title,journal_date,action_kind,content) values
   ('${T}','${WA}','${A}','undated task','2020-01-01','task','canonical body'),
   ('${N}','${WA}','${A}','note','2020-01-01','note','memo source'),
   ('${D}','${WA}','${A}','deadline','2020-01-01','task',''),
   ('${OTHER}','${WB}','${B}','other user','2020-01-01','task',''),
   ('${S}','${WA}','${A}','schedule source','2020-01-01','task',''),
   ('${R}','${WA}','${A}','repeat parent','2020-01-01','task','');
   update worklog.work_records set due_at='2030-01-01' where id='${D}';
   insert into worklog.repeating_work values('${R}');
   insert into worklog.schedules(workspace_id,created_by_user_id,title,starts_at,metadata) values('${WA}','${A}','appointment','2030-01-01','{"workRecordId":"${S}"}');`);
  await db.exec(fs.readFileSync('supabase/migrations/20261117112533_personal_work_folders.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261118001000_memo_completion_history.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261118003000_work_record_destination.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261117162554_work_overview.sql','utf8'));
  const overview=async(all=true,folder=null,section='tasks',offset=0)=>(await db.query('select worklog.get_my_work_overview($1,$2,$3,$4) value',[all,folder,section,offset])).rows[0].value;
  let owner=A;
  const login = async who => { owner=who; return db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${who}',false)`); };
  const save = (fid,name,parent,version) => db.query('select worklog.save_my_work_folder($1,$2,$3,$4,$5)',[owner,fid,name,parent,version]);
  const organize = (rid,version,command) => db.query('select worklog.organize_my_work_record($1,$2,$3,$4)',[owner,rid,version,command]);
  const list = async (folder=null,section='tasks',offset=0) => (await db.query('select worklog.list_my_folder_records($1,$2,$3) value',[folder,section,offset])).rows[0].value;
  await login(A);
  assert.deepEqual((await list()).map(r=>r.id).sort(),[T,D].sort());
  await save(F,'Projects',null,-1);await save(F,'Projects',null,-1); // lost response retry
  await save(CHILD,'Child',F,-1);
  await assert.rejects(save(F,'Projects',CHILD,0),/FOLDER_CYCLE/);
  await assert.rejects(db.query('update worklog.work_folders set parent_id=$1 where id=$2',[CHILD,F]),/FOLDER_CYCLE/);
  await assert.rejects(save(F,'Projects',F,0),/FOLDER_CYCLE|check constraint/);
  await save(CHILD,'Renamed',null,0);await save(CHILD,'Renamed',F,1);
  await assert.rejects(save(CHILD,'stale',null,0),error=>error.code==='PT409' && /VERSION_CONFLICT/.test(error.message));
  const before=(await db.query('select * from worklog.work_records where id=$1',[T])).rows[0];
  const schedules=(await db.query('select * from worklog.schedules')).rows;
  await organize(T,-1,{folder:CHILD});await organize(T,0,{today:true});
  assert.equal((await list(CHILD))[0].content,'canonical body');
  const all=await overview();
  assert.equal(all.all_tasks,2);assert.equal(all.unclassified_tasks,1);assert.equal(all.total_count,2);
  assert.equal(all.folders.find(f=>f.id===F).task_count,1,'parent includes descendant');
  assert.equal(all.folders.find(f=>f.id===CHILD).task_count,1);
  assert.deepEqual((await overview(false,F)).records.map(r=>r.id),[T]);
  assert.deepEqual((await overview(false,null)).records.map(r=>r.id),[D]);
  assert.equal((await overview(false,F)).total_count,1);
  await assert.rejects(overview(true,null,'today'),/INVALID_SECTION/);

  assert.equal((await list(null,'today'))[0].id,T);
  assert.deepEqual((await db.query('select * from worklog.work_records where id=$1',[T])).rows[0],before);
  assert.deepEqual((await db.query('select * from worklog.schedules')).rows,schedules);
  await assert.rejects(organize(D,-1,{today:true}),/UNDATED_OPEN_TASK_REQUIRED/);
  await assert.rejects(organize(N,-1,{today:true}),/UNDATED_OPEN_TASK_REQUIRED/);
  await assert.rejects(organize(S,-1,{today:true}),/WORK_NOT_AVAILABLE/);
  await assert.rejects(organize(R,-1,{today:true}),/WORK_NOT_AVAILABLE/);
  await organize(N,-1,{folder:CHILD});assert.equal((await list(CHILD,'notes'))[0].content,'memo source');
  await db.query("update worklog.work_organization set selected_on='2020-01-01' where work_record_id=$1",[T]);
  assert.equal((await list(null,'today'))[0].id,T,'unfinished selection carries over');
  await db.query("update worklog.work_records set status='completed' where id=$1",[T]);
  assert.equal((await list(null,'today')).length,0);assert.equal((await list(CHILD,'completed'))[0].id,T);
  assert.equal((await overview()).all_tasks,1);
  assert.equal((await overview(false,F)).folders.find(f=>f.id===F).task_count,0);
  assert.equal((await overview(false,F,'completed')).records[0].id,T);

  const journal=(await db.query("select * from worklog.get_my_work_journal_day((now() at time zone 'Asia/Seoul')::date)")).rows[0];
  assert.equal(journal.completed[0].id,T);
  await db.query("update worklog.work_records set status='in_progress' where id=$1",[T]);
  assert.equal((await list(CHILD,'completed')).length,0);assert.equal((await list(null,'today'))[0].id,T);
  await organize(T,1,{today:false});assert.equal((await list(null,'today')).length,0);assert.equal((await list(CHILD))[0].id,T);
  await organize(T,2,{folder:null});assert.ok((await list()).some(r=>r.id===T));
  // Completed notes disappear from active folders, remain in completion-day history,
  // preserve the original journal date/body, and return on Undo.
  await db.query("update worklog.work_records set briefing_state='acknowledged' where id=$1",[N]);
  assert.equal((await list(CHILD,'notes')).length,0);
  const doneNote=(await list(CHILD,'completed')).find(r=>r.id===N);
  assert.equal((await overview(false,F,'notes')).total_count,0);
  assert.equal((await overview(false,F,'completed')).records[0].id,N);
  assert.ok(doneNote.acknowledged_at);assert.equal(doneNote.content,'memo source');
  const doneDay=(await db.query("select * from worklog.get_my_work_journal_day((now() at time zone 'Asia/Seoul')::date)")).rows[0];
  assert.ok(doneDay.completed.some(r=>r.id===N && r.completed_at));
  const originalDay=(await db.query("select * from worklog.get_my_work_journal_day('2020-01-01')")).rows[0];
  assert.ok(originalDay.notes.some(r=>r.id===N),'original note is not moved or deleted');
  await db.query("update worklog.work_records set briefing_state='active' where id=$1",[N]);
  assert.ok((await list(CHILD,'notes')).some(r=>r.id===N));
  assert.ok(!(await list(CHILD,'completed')).some(r=>r.id===N));
  await login(B);
  await assert.rejects(db.query('select worklog.save_my_work_folder($1,$2,$3,$4,$5)',[A,id(30),'old account draft',null,-1]),/AUTH_REQUIRED/);
  await save(FOREIGN,'Private',null,-1);
  assert.equal((await overview()).all_tasks,1);assert.equal((await overview(false,F)).total_count,0);assert.equal((await overview()).folders.length,1);
  assert.equal((await list()).length,1);assert.equal((await list(F)).length,0);
  assert.equal((await db.query('select * from worklog.work_organization')).rows.length,0);
  await assert.rejects(organize(T,-1,{folder:FOREIGN}),/WORK_NOT_AVAILABLE/);
  await assert.rejects(save(id(20),'bad',F,-1),/foreign key/);
  await assert.rejects(db.query('insert into worklog.work_organization(work_record_id) values($1)',[T]),/row-level security/);
  await login(A);
  assert.equal((await db.query('select worklog.list_my_work_folders() value')).rows[0].value.length,2,'fresh login sees persisted personal hierarchy');
  await assert.rejects(organize(T,3,{folder:FOREIGN}),/foreign key/);
  await assert.rejects(db.query('update worklog.work_folders set user_id=$1 where id=$2',[B,F]),/FOLDER_OWNER/);
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select worklog.list_my_work_folders()'),/permission denied/);
  await assert.rejects(overview(),/permission denied/);
  await db.exec('reset role');
  for(let n=100;n<155;n++)await db.query('insert into worklog.work_records(id,workspace_id,created_by_user_id,title,journal_date) values($1,$2,$3,$4,$5)',[id(n),WA,A,`task ${n}`,'2020-01-01']);
  await login(A);assert.equal((await list()).length,50);assert.equal((await list(null,'tasks',50)).length,7);
  const paged=await overview();assert.equal(paged.all_tasks,57);assert.equal(paged.records.length,50);assert.equal(paged.total_count,57);assert.equal((await overview(true,null,'tasks',50)).records.length,7);
  // Explicit date-free conversion: atomic folder choice, source preservation,
  // cancellation of both source and reminder schedules, stale/foreign rejection.
  await db.query("update worklog.work_records set due_at='2030-01-01',next_attention_at='2030-01-02',content='keep body',original_text='keep voice',metadata='{\"actionEngine\":{\"kind\":\"schedule\"}}' where id=$1",[S]);
  await db.query("update worklog.schedules set metadata=metadata || '{\"externalEventId\":\"keep-google-id\"}'::jsonb where metadata->>'workRecordId'=$1",[S]);
  await db.query("insert into worklog.schedules(workspace_id,created_by_user_id,title,starts_at,metadata) values($1,$2,'reminder','2030-01-01',jsonb_build_object('reminderWorkRecordId',$3::text))",[WA,A,S]);
  const snapshot=async()=> (await db.query('select worklog.get_my_work_record_destination($1) value',[S])).rows[0].value;
  const move=(snap,folder=CHILD,kind='task',who=A)=>db.query('select worklog.move_my_work_record_to_folder($1,$2,$3,$4,$5,$6,$7) value',[who,S,'Moved work',kind,folder,snap.updatedAt,snap.version]);
  const snap=await snapshot();
  await assert.rejects(move(snap,FOREIGN),/FOLDER_NOT_AVAILABLE/);
  assert.equal((await db.query("select count(*)::int n from worklog.schedules where status='cancelled'")).rows[0].n,0,'bad folder rolls back everything');
  await assert.rejects(move(snap,CHILD,'other'),/INVALID_DESTINATION/);
  const result=(await move(snap)).rows[0].value;assert.equal(result.cancelledScheduleIds.length,2);
  const converted=(await db.query('select * from worklog.work_records where id=$1',[S])).rows[0];
  assert.equal(converted.original_text,'keep voice');assert.equal(converted.content,'keep body');assert.equal(converted.due_at,null);assert.equal(converted.next_attention_at,null);assert.equal(converted.status,'in_progress');
  assert.equal(converted.metadata.actionEngine.kind,'task');assert.ok(converted.metadata.lastWorkDestination.previousDueAt);
  assert.ok((await list(CHILD)).some(row=>row.id===S));
  assert.equal((await db.query("select metadata->>'externalEventId' value from worklog.schedules where metadata->>'workRecordId'=$1",[S])).rows[0].value,'keep-google-id');
  await assert.rejects(move(snap),e=>e.code==='PT409');
  await move(await snapshot(),null,'note');assert.ok((await list(null,'notes')).some(row=>row.id===S));
  await login(B);assert.equal(await snapshot(),null);await assert.rejects(move(snap),/AUTH_REQUIRED/);
  await assert.rejects(move(snap,null,'task',B),/WORK_NOT_AVAILABLE/);
  await login(A);
  await db.query("update worklog.work_records set status='completed' where id=$1",[S]);
  assert.equal(await snapshot(),null);await assert.rejects(move(snap),/WORK_NOT_AVAILABLE/);
  assert.equal((await db.query('select worklog.get_my_work_record_destination($1) value',[R])).rows[0].value,null,'repeating work remains independent');
 } finally { await db.close(); }
});
