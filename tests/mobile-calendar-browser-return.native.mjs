import test from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { authorizeGoogleCalendar } = await import('../mobile/src/features/calendar/google-calendar-authorization.ts');
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const callback = 'worklog-qa://google-auth';

// Execute the installed Expo Android redirect matcher; only native event/browser
// boundaries are replaced. OAuth query order is deliberately code-first.
function androidBrowser(returnedUrl) {
  const links = new Set(), states = new Set();
  const emitter = set => ({ addEventListener: (_name, fn) => {
    set.add(fn); return { remove: () => set.delete(fn) };
  }});
  const native = { openBrowserAsync: async () => {
    setImmediate(() => {
      if (returnedUrl) for (const fn of links) fn({ url: returnedUrl });
      setImmediate(() => { for (const fn of states) fn('active'); });
    });
    return { type: 'opened' };
  }};
  const compiled = ts.transpileModule(readFileSync(require.resolve('expo-web-browser/src/WebBrowser.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(name => {
    if (name === 'react-native') return {
      Platform: { OS: 'android' }, processColor: value => value,
      Linking: emitter(links), AppState: { currentState: 'active', ...emitter(states) },
    };
    if (name === 'expo-modules-core') return { UnavailabilityError: Error };
    if (name === './ExpoWebBrowser') return native;
    if (name === './WebBrowser.types') return { WebBrowserResultType: { CANCEL: 'cancel', DISMISS: 'dismiss' } };
    throw Error('unexpected import ' + name);
  }, exports);
  return { open: exports.openAuthSessionAsync, listeners: () => links.size + states.size };
}
const config = { supabaseUrl: 'https://synthetic.invalid', publishableKey: 'public-test' };
const proof = async () => ({ verifier: 'a'.repeat(64), challenge: 'b'.repeat(43) });
function exchange() {
  let calls = 0;
  return { count: () => calls, fetch: async url => {
    calls++;
    return String(url).includes('/token?') ? Response.json({ provider_token: 'synthetic' })
      : Response.json({ id: 'synthetic', email: 'qa@example.invalid', verified_email: true });
  }};
}
test('installed Android browser handles reordered Calendar callback instead of reporting dismiss', async () => {
  const browser = androidBrowser(callback + '?code=synthetic&purpose=calendar');
  const api = exchange();
  const result = await authorizeGoogleCalendar(config, callback, browser.open, proof, api.fetch);
  assert.equal(result?.email, 'qa@example.invalid');
  assert.equal(api.count(), 2);
  await new Promise(setImmediate); // Flush the simulated native foreground event.
  assert.equal(browser.listeners(), 0);
});
test('reordered provider denial remains denied and never exchanges a code', async () => {
  const browser = androidBrowser(callback + '?error=access_denied&purpose=calendar');
  const api = exchange();
  await assert.rejects(authorizeGoogleCalendar(config, callback, browser.open, proof, api.fetch), /CALENDAR_AUTH_DENIED/);
  assert.equal(api.count(), 0);
  await new Promise(setImmediate); // Flush the simulated native foreground event.
  assert.equal(browser.listeners(), 0);
});
test('base browser return match still rejects app-login callbacks without Calendar purpose', async () => {
  const browser = androidBrowser(callback + '?code=app-login');
  const api = exchange();
  await assert.rejects(authorizeGoogleCalendar(config, callback, browser.open, proof, api.fetch), /CALENDAR_AUTH_FAILED/);
  assert.equal(api.count(), 0);
});
test('closing Android browser without any callback stays cancelled', async () => {
  const browser = androidBrowser(null);
  const api = exchange();
  assert.equal(await authorizeGoogleCalendar(config, callback, browser.open, proof, api.fetch), null);
  assert.equal(api.count(), 0);
  await new Promise(setImmediate); // Flush the simulated native foreground event.
  assert.equal(browser.listeners(), 0);
});
