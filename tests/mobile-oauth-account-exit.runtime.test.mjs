import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const authSource = readFileSync('mobile/src/platform/google-auth.ts', 'utf8');
const providerSource = readFileSync('mobile/src/providers/platform-provider.tsx', 'utf8');
const ast = ts.createSourceFile('google-auth.ts', authSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ['parseGoogleAuthCallback','completeGoogleOAuthCallback','completeGoogleOAuthFromUrl','beginGoogleOAuth'];
function declaration(name) {
  let found = '';
  function walk(n) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(ast).replace(/^export /,'');
    ts.forEachChild(n,walk);
  }
  walk(ast);
  assert.ok(found, 'missing real OAuth implementation: ' + name);
  return found;
}
function harness() {
  const events = [];
  const scope = {
    MOBILE_AUTH_CALLBACK_URL: 'worklog://google-auth',
    GOOGLE_AUTH_REDIRECT_URL: 'worklog://google-auth',
    WebBrowser: {
      async openAuthSessionAsync(_url,redirect) {
        events.push('browser');
        assert.equal(redirect,'worklog://google-auth');
        return { type:'success',url:'worklog://google-auth?code=synthetic-oauth-code' };
      },
    },
  };
  const code = 'let callbackInFlight = null;\n' + names.map(declaration).join('\n');
  const js = ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const api = new Function('scope','with(scope) { ' + js + '; return { '+names.join(',')+' }; }')(scope);
  const client = { auth: {
    async signInWithOAuth(input) {
      assert.equal(input.provider,'google');
      events.push('oauth-url');
      return { data:{url:'https://synthetic.invalid/auth'},error:null };
    },
    async setSession(tokens) {
      events.push('set-session');
      assert.equal(tokens.access_token,'synthetic-access');
      return { error:null };
    },
    async exchangeCodeForSession(code) {
      events.push('exchange-session');
      assert.equal(code,'synthetic-oauth-code');
      return { error:null };
    },
  }};
  return { ...api, events, client };
}
function barrier() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {promise,release:()=>release()};
}
test('cold OAuth access-token callback cannot switch account before native cleanup succeeds',async()=>{
  const h=harness(),gate=barrier();
  const pending=h.completeGoogleOAuthFromUrl(h.client,
    'worklog://google-auth?access_token=synthetic-access&refresh_token=synthetic-refresh',
    async()=>{h.events.push('cleanup');await gate.promise;});
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(h.events,['cleanup'],'old OS reminder cleanup must complete before account changes');
  gate.release();
  assert.equal(await pending,true);
  assert.deepEqual(h.events,['cleanup','set-session']);
});
test('cleanup failure rejects code exchange, keeps old session and permits explicit retry',async()=>{
  const h=harness(),uri='worklog://google-auth?code=synthetic-oauth-code';
  await assert.rejects(
    h.completeGoogleOAuthFromUrl(h.client,uri,async()=>{h.events.push('cleanup-failed');throw Error('native unavailable');}),
    /native unavailable/);
  assert.deepEqual(h.events,['cleanup-failed']);
  assert.equal(await h.completeGoogleOAuthFromUrl(h.client,uri,async()=>{h.events.push('cleanup-confirmed');}),true);
  assert.deepEqual(h.events,['cleanup-failed','cleanup-confirmed','exchange-session']);
});
test('simultaneous warm deep link and browser callback share one cleanup and one exchange',async()=>{
  const h=harness(),gate=barrier();
  const clean=async()=>{h.events.push('cleanup');await gate.promise;};
  const browser=h.beginGoogleOAuth(h.client,clean);
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  const warm=h.completeGoogleOAuthFromUrl(h.client,'worklog://google-auth?code=synthetic-oauth-code',clean);
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.events.filter(x=>x==='cleanup').length,1);
  gate.release();
  assert.equal(await warm,true);
  assert.equal(await browser,'success');
  assert.deepEqual(h.events,['oauth-url','browser','cleanup','exchange-session']);
});
test('Calendar OAuth and invalid callbacks do not clear reminders or replace login sessions',async()=>{
  const h=harness(),url='worklog://google-auth?purpose=calendar&code=synthetic-oauth-code';
  const result=await h.completeGoogleOAuthFromUrl(h.client,url,async()=>{h.events.push('unexpected-cleanup');});
  assert.equal(result,false);assert.deepEqual(h.events,[]);
  await assert.rejects(h.completeGoogleOAuthFromUrl(h.client,'worklog://google-auth',
    async()=>{h.events.push('unexpected-cleanup');}),/Supabase 세션을 확인하지 못했습니다/);
  assert.deepEqual(h.events,[]);
});
test('PlatformProvider wires guard for cold, warm and interactive OAuth entry points',()=>{
  assert.match(providerSource,/completeGoogleOAuthFromUrl\(nextClient, initialUrl, clearDeviceRemindersForAccountExit\)/);
  assert.match(providerSource,/completeGoogleOAuthFromUrl\(nextClient, url, clearDeviceRemindersForAccountExit\)/);
  assert.match(providerSource,/beginGoogleOAuth\(client, clearDeviceRemindersForAccountExit\)/);
  assert.match(authSource,/await beforeSessionChange\?\.\(\);[\s\S]*?client\.auth\.setSession/);
  assert.match(authSource,/await beforeSessionChange\?\.\(\);[\s\S]*?client\.auth\.exchangeCodeForSession/);
});
