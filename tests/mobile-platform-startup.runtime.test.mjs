import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {nativeComponentHarness} from './helpers/native-component-harness.mjs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const gate=await import('../mobile/src/platform/local-account-gate.ts');
const epochs=await import('../mobile/src/features/schedule/schedule-reminder-snapshot.ts');
const deadline=await import('../mobile/src/platform/request-deadline.ts');
const reminders=await import('../mobile/src/features/schedule/schedule-reminder-service.ts');
const {startupFixture,scope,delay}=await import('./helpers/startup-reminder-fixture.mjs');
const A={user:{id:'A'}},B={user:{id:'B'}};
async function harness(){
 const h=await startupFixture(reminders.createScheduleReminderService,{accountScope:scope()});
 let listener,release,checks=0,meetingOwner;const client={auth:{
  getSession:async()=>({data:{session:A},error:null}),
  getUser:()=>++checks===1?new Promise(r=>release=r):Promise.resolve({data:{user:B.user},error:null}),
  onAuthStateChange(fn){listener=fn;return{data:{subscription:{unsubscribe(){listener=null}}}}},startAutoRefresh(){},stopAutoRefresh(){},
  async signOut(){listener?.('SIGNED_OUT',null);return{error:null}},
 }};
 const ui=nativeComponentHarness('mobile/src/providers/platform-provider.tsx','PlatformProvider',{
  '@/src/platform/request-deadline':deadline,'@/src/platform/local-account-gate':gate,
  '@/src/features/voice/meeting-owner':{selectMeetingOwner:v=>meetingOwner=v},
  '@/src/features/calendar/calendar-service':{selectCalendarOwner(){},resetCalendarConnection(){},verifyCalendarNativeCrypto:async()=>{}},
  'expo-linking':{getInitialURL:async()=>null,addEventListener:()=>({remove(){}})},
  '@/src/features/schedule/local-notifications':h.service,'@/src/features/schedule/schedule-reminder-snapshot':epochs,
  '@/src/platform/auth-preferences':{loadRememberedLoginEmail:async()=>'',saveRememberedLoginEmail:async()=>{}},
  '@/src/platform/secure-storage':{secureSessionStorage:h.storage},
  '@/src/platform/config':{loadPublicPlatformConfig:async()=>({configured:true,supabaseUrl:'https://project-a.invalid',dataSchema:'worklog'})},
  '@/src/platform/google-auth':{isGoogleAuthCallbackUrl:()=>false},
  '@/src/platform/supabase':{createPlatformSupabaseClient:()=>client},
 });
 ui.render({});await ui.effects();for(let n=0;n<20&&!release;n++)await delay(1);assert.ok(release);
 return{h,ui,event:(event,s)=>listener(event,s),finish:()=>release({data:{user:A.user},error:null}),owner:()=>meetingOwner,value:()=>ui.render({}).props.value};
}
test('actual provider subscribes during initial verification: B supersedes late A, logout clears before publication',async()=>{
 const t=await harness();try{
  assert.equal(t.value().session,null);t.event('SIGNED_IN',B);await delay(15);assert.equal(t.value().session,B);assert.equal(t.owner(),'B');assert.equal(t.h.os.size,0);
  t.finish();await delay(5);assert.equal(t.value().session,B);assert.equal(t.value().phase,'ready');
  await t.value().signOut();await delay(5);assert.equal(t.value().session,null);assert.equal(t.owner(),null);
 }finally{t.ui.close()}
});
test('actual provider disposal blocks pending identity and preserves proved same-account custom alarms',async()=>{
 const t=await harness();t.ui.close();t.finish();await delay(5);
 assert.equal(t.owner(),null);assert.equal(t.h.counts.cancel,0);assert.equal(t.h.os.size,12);assert.equal(t.value().session,null);
});
