import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createCalendarConnection } = await import('../mobile/src/features/calendar/calendar-connection.ts');
const { createCalendarCredentialStore } = await import('../mobile/src/features/calendar/calendar-credential-store.ts');
const { createGoogleCalendarRenewer } = await import('../mobile/src/features/calendar/google-calendar-renewal.ts');
const { createGoogleRefreshHandler } = await import('../netlify/shared/calendar/google-refresh.mjs');
const target = { accountId: 'google-one', calendarId: 'primary' };
const range = { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
const data = { events: [{ id: 'event-one' }], limited: false };
function harness(renewFn) {
  let now = 0, renews = 0, clears = 0, saved = 0, reads = 0;
  const conn = expiresAt => ({ target, email: 'synthetic@example.invalid', expiresAt,
    adapter: { target, get: async () => null, insert: async () => {}, list: async () => { reads++; return data; } },
    persist: async () => { saved++; }, renew: async () => { renews++; return renewFn ? renewFn(conn) : conn(now + 100); } });
  const service = createCalendarConnection({ authorize: async () => conn(100), now: () => now, clear: async () => { clears++; } });
  return { service, conn, expire: () => { now = 101; }, stats: () => ({ renews, clears, saved, reads }) };
}
test('expired token renews silently once across concurrent reads; no browser reconnect', async () => {
  const h = harness(); await h.service.connect(); h.expire();
  assert.equal(h.service.info().expired, false);
  const [a,b] = await Promise.all([h.service.readEvents(range),h.service.readEvents(range)]);
  assert.deepEqual(a,data); assert.deepEqual(b,data);
  assert.equal(h.stats().renews,1); assert.equal(h.stats().saved,2);
});
test('renewal network failure preserves connection and next attempt succeeds', async () => {
  let fail = true;
  const h = harness(conn => { if (fail) throw Error('network'); return conn(300); });
  await h.service.connect(); h.expire();
  await assert.rejects(h.service.readEvents(range),/network/);
  assert.equal(h.service.info().expired,false); assert.equal(h.stats().clears,1);
  fail=false; assert.deepEqual(await h.service.readEvents(range),data);
});
test('invalid grant requests consent, clears saved grant and does not loop', async () => {
  const h=harness(()=>{throw Error('CALENDAR_REAUTH_REQUIRED');}); await h.service.connect();h.expire();
  await assert.rejects(h.service.readEvents(range),/REAUTH_REQUIRED/);
  await assert.rejects(h.service.readEvents(range),/REAUTH_REQUIRED/);
  assert.equal(h.stats().renews,1);assert.equal(h.service.info().expired,true);assert.equal(h.stats().clears,2);
});
test('disconnect during refresh cannot persist or resurrect a grant', async () => {
  let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));await h.service.connect();h.expire();
  const pending=h.service.readEvents(range);h.service.disconnect();finish(h.conn(300));
  await assert.rejects(pending,/OWNER_CHANGED/);assert.equal(h.service.info(),null);assert.equal(h.stats().saved,1);
});
test('changed Google identity cannot replace a connected account', async () => {
  const h=harness(conn=>({...conn(300),target:{...target,accountId:'other'}}));await h.service.connect();h.expire();
  await assert.rejects(h.service.readEvents(range),/REAUTH_REQUIRED/);assert.equal(h.stats().saved,1);
});
test('Google 401 renews and retries read once; persistent 401 is not an infinite loop', async () => {
  for (const stillFails of [false,true]) {
    const h=harness(conn=>{const next=conn(300);if(stillFails)next.adapter.list=async()=>{throw Error('CALENDAR_EXPIRED');};return next;});
    const initial=h.conn(100);initial.adapter.list=async()=>{throw Error('CALENDAR_EXPIRED');};
    const s=createCalendarConnection({authorize:async()=>initial,now:()=>0});await s.connect();
    if(stillFails)await assert.rejects(s.readEvents(range),/EXPIRED/);else assert.deepEqual(await s.readEvents(range),data);
    assert.equal(h.stats().renews,1);
  }
});
test('restart keeps expired access credential when renewable; encrypted owner namespace is preserved', async () => {
  const map=new Map();const storage={getItem:async k=>map.get(k),setItem:async(k,v)=>map.set(k,v),removeItem:async k=>map.delete(k)};
  let renewed=0;
  const store=createCalendarCredentialStore(storage,'project','owner',async()=>Response.json({items:[]}),()=>101,
    async c=>{renewed++;return {...c,token:'new-google',expiresAt:300};});
  await store.save({target,email:'s@example.invalid',token:'old',refreshToken:'google-refresh',expiresAt:100});
  const s=createCalendarConnection({authorize:async()=>null,restore:store.restore,now:()=>101});await s.restore();
  await s.readEvents(range);assert.equal(renewed,1);assert.equal((await store.restore()).expiresAt,300);
  assert.ok(!JSON.stringify(s.info()).includes('google-refresh'));
});
const settings={SUPABASE_URL:'https://supabase.invalid',SUPABASE_PUBLISHABLE_KEY:'public',GOOGLE_CALENDAR_CLIENT_ID:'synthetic-client',GOOGLE_CALENDAR_CLIENT_SECRET:'synthetic-secret'};
function server(overrides={}) {
  const calls=[];
  const handle=createGoogleRefreshHandler({env:k=>settings[k],fetchImpl:async(url,init)=>{
    calls.push({url,init});
    if(url.includes('/auth/v1/user')) return Response.json({id:'owner'});
    if(url.includes('/token')) return overrides.token || Response.json({access_token:'fresh',expires_in:3600});
    return overrides.identity || Response.json({id:'google-one',verified_email:true});
  }});
  return {calls,handle};
}
const request=(body={},token='app-login')=>new Request('https://app.invalid/api/google-calendar-refresh',{method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body:JSON.stringify({ownerId:'owner',accountId:'google-one',refreshToken:'synthetic-refresh',...body})});
test('server authenticates owner before token exchange; secrets never enter responses',async()=>{
  const h=server();const r=await h.handle(request());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  const result=await r.json();assert.equal(result.accessToken,'fresh');assert.equal(result.expiresIn,3600);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'));assert.ok(!JSON.stringify(result).includes('synthetic-refresh'));
  assert.equal(h.calls[0].url,'https://supabase.invalid/auth/v1/user');
  assert.equal(new URLSearchParams(h.calls[1].init.body).get('grant_type'),'refresh_token');
  assert.equal(h.calls[2].init.headers.Authorization,'Bearer fresh');
});
test('missing login or wrong owner cannot call Google',async()=>{
  const h=server();assert.equal((await h.handle(request({},''))).status,401);assert.equal(h.calls.length,0);
  assert.equal((await h.handle(request({ownerId:'other'}))).status,401);assert.equal(h.calls.length,1);
});
test('server distinguishes invalid grant from configuration, quota and network failure',async()=>{
  for(const [error,expected] of [['invalid_grant','CALENDAR_REAUTH_REQUIRED'],['invalid_client','CALENDAR_REFRESH_FAILED'],['rate_limit_exceeded','CALENDAR_REFRESH_FAILED']]){
    const h=server({token:Response.json({error,error_description:'sensitive'},{status:400})});
    const result=await(await h.handle(request())).json();assert.equal(result.error,expected);assert.ok(!JSON.stringify(result).includes('sensitive'));
  }
  const h=createGoogleRefreshHandler({env:()=>undefined});assert.equal((await(await h(request())).json()).error,'CALENDAR_REFRESH_NOT_CONFIGURED');
});
test('server validates returned Google identity and malformed request',async()=>{
  const h=server({identity:Response.json({id:'other',verified_email:true})});assert.equal((await(await h.handle(request())).json()).error,'CALENDAR_REAUTH_REQUIRED');
  const k=server();assert.equal((await k.handle(request({refreshToken:''}))).status,400);assert.equal(k.calls.length,0);
});
test('mobile renewal uses app auth only on own server, correct identity and actual Google expiry',async()=>{
  let call;const renew=createGoogleCalendarRenewer('owner',async()=>'app-token',async(url,init)=>{call={url,init};return Response.json({accessToken:'fresh',expiresIn:1800,accountId:'google-one'});},'https://app.invalid');
  const before=Date.now();const c=await renew({target,email:'s@example.invalid',expiresAt:1,token:'old',refreshToken:'google-refresh'});
  assert.equal(call.url,'https://app.invalid/api/google-calendar-refresh');assert.equal(call.init.headers.Authorization,'Bearer app-token');
  assert.equal(c.refreshToken,'google-refresh');assert.ok(c.expiresAt>=before+1740000 && c.expiresAt<=Date.now()+1740000);
});
const source={scheduleId:'22222222-2222-4222-8222-222222222222',title:'synthetic',status:'confirmed',timeZone:'Asia/Seoul',allDay:false,start:'2026-11-17T10:00:00+09:00',end:'2026-11-17T11:00:00+09:00',ownerId:'owner',workspaceId:'workspace',revision:'r1'};
test('expired export renews before write and duplicate taps still create one event',async()=>{
  let event=null,posts=0;
  const h=harness(conn=>({...conn(300),adapter:{target,get:async()=>event,insert:async(id,draft)=>{posts++;return event={id,status:'confirmed',sourceId:draft.scheduleId,draft};}}}));
  await h.service.connect();h.expire();const a=h.service.send(source,'',async()=>source,()=>true),b=h.service.send(source,'',async()=>source,()=>true);
  assert.equal(a,b);assert.equal((await a).state,'confirmed');assert.equal(posts,1);assert.equal(h.stats().renews,1);
});
test('disconnect while export renewal waits prevents any Google write',async()=>{
  let finish,posts=0;
  const h=harness(()=>new Promise(resolve=>{finish=resolve;}));await h.service.connect();h.expire();
  const a=h.service.send(source,'',async()=>source,()=>true);h.service.disconnect();finish({...h.conn(300),adapter:{target,get:async()=>null,insert:async()=>{posts++;}}});
  assert.notEqual((await a).state,'confirmed');assert.equal(posts,0);
});
test('server transport failure is retryable and does not echo request tokens',async()=>{
  const handle=createGoogleRefreshHandler({env:k=>settings[k],fetchImpl:async()=>{throw Error('synthetic-refresh');}});
  const response=await handle(request());assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'CALENDAR_REFRESH_FAILED'});
});
