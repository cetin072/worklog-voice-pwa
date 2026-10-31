import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createCalendarConnection } = await import('../mobile/src/features/calendar/calendar-connection.ts');
const { readCalendarSource } = await import('../mobile/src/features/calendar/calendar-source.ts');
const { authorizeGoogleCalendar, createCalendarPkce } = await import('../mobile/src/features/calendar/google-calendar-authorization.ts');
const source = { scheduleId:'22222222-2222-4222-8222-222222222222', title:'합성 검수 일정', status:'confirmed',
  timeZone:'Asia/Seoul', allDay:false, start:'2026-11-02T10:00:00+09:00', end:'2026-11-02T11:00:00+09:00',
  ownerId:'app-owner', workspaceId:'workspace-one', revision:'2026-10-31T01:00:00Z' };
function connection(overrides={}) {
  let event = null; let posts=0; let now=0;
  const target={accountId:'different-google-id',calendarId:'primary'};
  const adapter={target,get:async()=>event,insert:async(id,draft)=>{posts++;event={id,status:'confirmed',sourceId:draft.scheduleId,draft};return event;},...overrides};
  const service=createCalendarConnection({authorize:async()=>({target,email:'synthetic@example.invalid',expiresAt:100,adapter}),now:()=>now});
  return {service,posts:()=>posts,expire:()=>now=101};
}
test('connected account is separate; double clicks share canonical reads/write; retry verifies same event',async()=>{
  const {service,posts}=connection(); await service.connect();
  let reads=0;const read=async()=>{reads++;return {...source};};
  const a=service.send(source,'',read,()=>true); const b=service.send(source,'',read,()=>true);
  assert.equal(a,b);assert.equal((await a).state,'confirmed');assert.equal(posts(),1);assert.equal(reads,3);
  assert.equal((await service.send(source,'',read,()=>true)).alreadyExists,true);assert.equal(posts(),1);
  assert.equal(source.ownerId,'app-owner'); assert.equal(service.info().target.accountId,'different-google-id');
});
test('source changed before send or while remote GET waits never inserts',async()=>{
  for (const changedAt of [1,2]) {
    const {service,posts}=connection();await service.connect();let n=0;
    const result=await service.send(source,'',async()=>++n>=changedAt?{...source,revision:'changed',title:'changed'}:{...source},()=>true);
    assert.equal(result.state,'blocked');assert.equal(posts(),0);
  }
});
test('expiry, cancellation, disconnect during canonical read and failure are not success',async()=>{
  const {service,posts,expire}=connection();await service.connect();expire();
  assert.equal((await service.send(source,'',async()=>source,()=>true)).state,'expired');assert.equal(posts(),0);
  await service.connect(); assert.equal(service.info(),null);
  const c=connection();await c.service.connect();
  const result=await c.service.send(source,'',async()=>{c.service.disconnect();return source;},()=>true);
  assert.equal(result.state,'cancelled');assert.equal(c.posts(),0);
  const cancelled=createCalendarConnection({authorize:async()=>null});assert.equal(await cancelled.connect(),false);
});
test('canonical RLS reader scopes exact ID/creator and rejects changed owner or inactive records',async()=>{
  let seen=[];let user='app-owner';let status='confirmed';
  const row=()=>({id:source.scheduleId,workspace_id:source.workspaceId,created_by_user_id:'app-owner',title:source.title,status,
    starts_at:source.start,ends_at:null,all_day:true,timezone:'Asia/Seoul',updated_at:source.revision});
  const query={select:()=>query,eq:(k,v)=>{seen.push([k,v]);return query;},single:async()=>({data:row(),error:null})};
  const client={auth:{getUser:async()=>({data:{user:{id:user}}})},from:()=>query};
  const read=()=>readCalendarSource(client,source.scheduleId,'app-owner',()=>true);
  const result=await read();assert.equal(result.start,'2026-11-02');assert.equal(result.end,'');
  assert.deepEqual(seen,[['id',source.scheduleId],['created_by_user_id','app-owner']]);
  status='cancelled';await assert.rejects(read,/SOURCE_UNAVAILABLE/);
  user='other';await assert.rejects(read,/SOURCE_OWNER_CHANGED/);
});
const config={supabaseUrl:'https://example.invalid',publishableKey:'public-test-key'};
const callback='worklog-qa://google-auth';
const {randomBytes,createHash}=await import('node:crypto');
const makePkce=()=>createCalendarPkce(async()=>randomBytes(32),async v=>createHash('sha256').update(v).digest('base64'));
function oauthHarness(change={}) {
  const calls=[];let authorizeUrl,proof;
  const open=async(url,redirect)=>{authorizeUrl=new URL(url);assert.equal(redirect,callback);return {type:'success',url:callback+'?purpose=calendar&code=synthetic-code',...change};};
  const fetcher=async(url,init)=>{
    calls.push({url,init});
    if(String(url).includes('/auth/v1/token')) {proof=JSON.parse(init.body);return Response.json({provider_token:'ephemeral-google-token',refresh_token:'discarded-app-refresh',provider_refresh_token:'discarded-google-refresh'});}
    return Response.json({id:'google-id',email:'synthetic@example.invalid',verified_email:true});
  };
  return {run:()=>authorizeGoogleCalendar(config,callback,open,makePkce,fetcher),calls,url:()=>authorizeUrl,proof:()=>proof};
}
test('native-compatible proof uses 256-bit random verifier and SHA256 base64url; failures never open OAuth',async()=>{
  const p=await createCalendarPkce(async()=>new Uint8Array(32).fill(42),async v=>createHash('sha256').update(v).digest('base64'));
  assert.equal(p.verifier,'2a'.repeat(32));assert.equal(p.challenge,createHash('sha256').update(p.verifier).digest('base64url'));assert.equal(p.challenge.length,43);
  await assert.rejects(createCalendarPkce(async()=>new Uint8Array(0),async()=>''),/CRYPTO_UNAVAILABLE/);
  let opened=0;
  await assert.rejects(authorizeGoogleCalendar(config,callback,async()=>{opened++;},async()=>({verifier:'a'.repeat(64),challenge:'plain'})),/CRYPTO_UNAVAILABLE/);
  assert.equal(opened,0);
});
test('OAuth uses only S256/online grant, public-key PKCE exchange, and verified Google identity',async()=>{
  const h=oauthHarness();const result=await h.run();const url=h.url();
  assert.equal(result.email,'synthetic@example.invalid');assert.deepEqual(result.target,{accountId:'google-id',calendarId:'primary'});
  assert.equal(url.origin,'https://example.invalid');assert.equal(url.pathname,'/auth/v1/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.equal(url.searchParams.get('access_type'),'online');
  assert.match(url.searchParams.get('scopes'),/calendar.events.owned/);assert.equal(url.searchParams.get('redirect_to'),callback+'?purpose=calendar');
  assert.equal(h.calls[0].url,'https://example.invalid/auth/v1/token?grant_type=pkce');assert.equal(h.calls[0].init.headers.apikey,'public-test-key');
  assert.equal(h.proof().auth_code,'synthetic-code');assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(h.proof().code_verifier).digest('base64url'));
  assert.ok(!url.toString().includes(h.proof().code_verifier));assert.ok(!JSON.stringify(result).includes('ephemeral-google-token'));
  assert.equal(h.calls[1].url,'https://www.googleapis.com/oauth2/v2/userinfo');
});
test('OAuth cancel, denied, wrong callback, missing code never connects or exchanges credentials',async()=>{
  assert.equal(await oauthHarness({type:'cancel'}).run(),null);
  for(const [url,code] of [
    [callback+'?purpose=calendar&error=access_denied&error_description=private-data','CALENDAR_AUTH_DENIED'],
    ['worklog://google-auth?purpose=calendar&code=x','CALENDAR_AUTH_FAILED'],
    [callback+'?code=x','CALENDAR_AUTH_FAILED'],
    [callback+'?purpose=calendar#access_token=do-not-accept','CALENDAR_AUTH_FAILED'],
  ]) {const h=oauthHarness({url});await assert.rejects(h.run(),new RegExp(code));assert.equal(h.calls.length,0);}
});
test('installed app SDK session remains unchanged; Calendar tokens/verifier never reach durable storage',async()=>{
  const {createRequire}=await import('node:module');
  const {createClient}=createRequire(new URL('../mobile/package.json',import.meta.url))('@supabase/supabase-js');
  const jwt=`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:'app-owner',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.synthetic`;
  const appSession={access_token:jwt,refresh_token:'synthetic-app-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'app-owner',email:'original@example.invalid',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:'2026-01-01T00:00:00Z'}};
  const durable=new Map([['app-session',JSON.stringify(appSession)]]);let writes=0;
  const storage={getItem:async k=>durable.get(k)||null,setItem:async(k,v)=>{writes++;durable.set(k,v);},removeItem:async k=>{writes++;durable.delete(k);}};
  const primary=createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storage,storageKey:'app-session'},global:{fetch:async()=>{throw Error('primary auth must not send a request');}}});
  try {
    const before=await primary.auth.getSession();const h=oauthHarness();await h.run();
    assert.deepEqual((await primary.auth.getSession()).data.session,before.data.session);
    assert.equal(writes,0);assert.deepEqual([...durable.keys()],['app-session']);
    assert.ok(![...durable.values()].join().includes(h.proof().code_verifier));
  }finally{await primary.auth.dispose();}
});
test('Calendar callback cannot be completed by the existing durable login handler, even after restart',async()=>{
  const {createRequire}=await import('node:module');const {readFileSync}=await import('node:fs');
  const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
  const compiled=ts.transpileModule(readFileSync('mobile/src/platform/google-auth.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exp={};new Function('require','exports',compiled)(name=>name==='expo-web-browser'?{maybeCompleteAuthSession(){}}:{},exp);
  const base=exp.MOBILE_AUTH_CALLBACK_URL;
  const client={auth:{exchangeCodeForSession(){throw Error('must not reach primary');},setSession(){throw Error('must not reach storage');}}};
  assert.equal(exp.isGoogleAuthCallbackUrl(base+'?purpose=calendar&code=synthetic'),false);
  assert.equal(await exp.completeGoogleOAuthFromUrl(client,base+'?purpose=calendar&code=synthetic'),false);
  assert.equal(exp.isGoogleAuthCallbackUrl(base+'?code=normal-login'),true);
});

