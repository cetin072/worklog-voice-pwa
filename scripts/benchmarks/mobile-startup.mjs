// Node-only synthetic experiment. No network, accounts or real native state.
// Run: node scripts/benchmarks/mobile-startup.mjs [baseline-ref]
import {execFileSync} from 'node:child_process';
import {register,stripTypeScriptTypes} from 'node:module';
import {performance} from 'node:perf_hooks';
register('../../tests/helpers/mobile-ts-loader.mjs',import.meta.url);
const root=new URL('../../',import.meta.url);
const baseline=process.argv[2]||'db25350c18aa73d10a3b0d15b52c8b733b94a817';
const oldModule=async path=>{
 let source=execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8'});
 source=stripTypeScriptTypes(source,{mode:'transform'}).replaceAll("'./schedule-reminder-snapshot'",JSON.stringify(new URL('mobile/src/features/schedule/schedule-reminder-snapshot.ts',root).href));
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
};
const oldService=await oldModule('mobile/src/features/schedule/schedule-reminder-service.ts');
const oldGate=await oldModule('mobile/src/platform/local-account-gate.ts');
const currentService=await import('../../mobile/src/features/schedule/schedule-reminder-service.ts');
const currentGate=await import('../../mobile/src/platform/local-account-gate.ts');
const {startupFixture,scope,delay}=await import('../../tests/helpers/startup-reminder-fixture.mjs');
const results=[];
for(const scenario of ['same-account','unknown-owner','account-change']){
 for(const version of ['before','after']){
  const samples=[];let counts,preserved;
  for(let n=0;n<5;n++){
   const modern=version==='after';
   const h=await startupFixture((modern?currentService:oldService).createScheduleReminderService,{
    count:12,latency:1,accountScope:scenario==='unknown-owner'?undefined:scope(),
   });
   let visible;const session={user:{id:scenario==='account-change'?'B':'A'}};
   const g=(modern?currentGate:oldGate).createLocalAccountGate({
    clear:s=>modern?h.service.prepareAccount(s?scope(s.user.id):null):h.service.clearForAccountExit(),
    verify:async()=>{await delay(40);return true;},
    confirm:(s,current)=>h.service.confirmAccount(scope(s.user.id),current),
    owner(){},publish:s=>visible=s,failed(){throw Error('unexpected synthetic failure')},
   });
   const start=performance.now();await g.transition(session);samples.push(Math.round(performance.now()-start));
   if(visible!==session)throw Error('account not published');counts={...h.counts};preserved=h.os.size;
  }
  const sorted=[...samples].sort((a,b)=>a-b);
  results.push({scenario,version,samplesMs:samples,medianMs:sorted[2],counts,preserved});
 }
}
console.log(JSON.stringify({baseline,environment:{runtime:process.version,fixture:'12 synthetic schedules; offsets 5/30/1440; actual durable storage + service + account gate',nativeStorageAndOsLatencyMs:1,identityLatencyMs:40,iterations:5,metric:'account transition wall time only; not device startup or first touch'},results},null,2));
