// Local, credential-free PostgreSQL restore verification. Input remains private.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {remapWorklogRows,transferCounts} from './remap-worklog-rows.mjs';
const [backupPath,migrationPath]=process.argv.slice(2);if(!backupPath||!migrationPath)throw Error('backup and migration paths required');
const bytes=await readFile(backupPath);const backup=JSON.parse(bytes);
assert.equal(backup.format,'taejang-worklog-pilot-backup-v1');
const from=backup.source.source_actor,actor=backup.targetBefore.profiles.find(p=>p.account_status==='active').id;
const mapped=remapWorklogRows(backup.source.tables,{[from]:actor});
const order=['workspaces','workspace_members','work_records','schedules','source_refs','candidates','input_captures','work_record_normalizations','usage_events','shared_cost_pools','shared_cost_allocations','notification_preferences','push_subscriptions','notification_deliveries'];
const db=new PGlite({extensions:{pg_trgm}});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
try{
 await db.exec(`create role anon; create role authenticated;create role service_role;create schema extensions;create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users(id),account_status text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 await db.exec('begin;'+await readFile(migrationPath,'utf8')+'commit;');
 await db.query('insert into auth.users values($1),($2)',[actor,from]);await db.query("insert into public.profiles values($1,'active'),($2,'active')",[actor,from]);
 await db.transaction(async tx=>{for(const t of order)await tx.query(`insert into worklog.${t} select * from jsonb_populate_recordset(null::worklog.${t},$1::jsonb)`,[JSON.stringify(mapped[t])]);});
 for(const t of order){if(t==='push_subscriptions')for(const row of mapped[t])if(row.disabled_at==='1970-01-01T00:00:00.000Z')row.disabled_at='1970-01-01T00:00:00+00:00';const actual=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') data from worklog.${t} t`)).rows[0].data;assert.equal(hash(actual.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),hash(mapped[t].map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),t+' exact restore including timestamps');}
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false)`);
 assert.equal((await db.query("select count(*)::int n from worklog.schedules where status='confirmed'")).rows[0].n,backup.source.tables.schedules.filter(s=>s.status==='confirmed').length);
 await assert.rejects(db.query("insert into worklog.schedules default values"),/permission denied/);
 await assert.rejects(db.query('select * from worklog.push_subscriptions'),/permission denied/);
 await db.exec(`select set_config('request.jwt.claim.sub','${from}',false)`);assert.equal((await db.query('select count(*)::int n from worklog.schedules')).rows[0].n,0);
 await db.exec('reset role');await db.query("update public.profiles set account_status='suspended' where id=$1",[actor]);
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false)`);assert.equal((await db.query('select count(*)::int n from worklog.schedules')).rows[0].n,0);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from worklog.schedules'),/permission denied/);
 console.log(JSON.stringify({pass:true,synthetic:false,localRestore:true,productionAuthExercised:false,backupSha256:createHash('sha256').update(bytes).digest('hex'),counts:transferCounts(mapped),exactRestoration:true,otherActorDenied:true,suspendedDenied:true,writesDenied:true,pushCredentialsDenied:true}));
}catch(error){console.error(JSON.stringify({pass:false,errorType:error.name,code:error.code||null}));process.exitCode=1;}finally{await db.close();}
