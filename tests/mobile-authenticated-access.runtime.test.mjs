import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { getFreshAccessToken } = await import('../mobile/src/platform/authenticated-access.ts');

test('mutation access token comes from the current Supabase session instead of a stale screen snapshot', async () => {
  const client = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: 'refreshed-token' } }, error: null };
      },
    },
  };
  assert.equal(await getFreshAccessToken(client), 'refreshed-token');
});

test('missing or failed refreshed session is surfaced as a login action instead of a generic mutation failure', async () => {
  await assert.rejects(
    () => getFreshAccessToken({ auth: { getSession: async () => ({ data: { session: null }, error: null }) } }),
    /세션이 만료/,
  );
  await assert.rejects(
    () => getFreshAccessToken({ auth: { getSession: async () => ({ data: { session: null }, error: new Error('refresh failed') }) } }),
    /세션을 갱신/,
  );
});
