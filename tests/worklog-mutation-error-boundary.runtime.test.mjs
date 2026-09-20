import assert from 'node:assert/strict';
import test from 'node:test';

import { createSupabaseDataCoreRestClient } from '../netlify/shared/data-core/supabase-rest-client.mjs';
import { createWorklogDataCoreEditor } from '../netlify/shared/worklog-data-core-editor.mjs';

const recordId = '12345678-1234-4234-8234-1234567890ab';

test('expired Supabase JWT is translated into a login/session error instead of generic 502 mutation failure', async () => {
  const client = createSupabaseDataCoreRestClient({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'publishable-key',
    accessToken: 'expired-token',
    fetchImpl: async () => Response.json(
      { code: 'PGRST303', message: 'JWT expired' },
      { status: 401 },
    ),
  });
  const editor = createWorklogDataCoreEditor({ client });
  await assert.rejects(
    () => editor.readDetails({ recordId }),
    (error) => error?.code === 'WORKLOG_DATA_CORE_EDIT_AUTH_REQUIRED'
      && /세션/.test(error.message),
  );
});

test('Supabase RPC network failures are translated into a retryable network error', async () => {
  const client = createSupabaseDataCoreRestClient({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'publishable-key',
    accessToken: 'session-token',
    fetchImpl: async () => { throw new TypeError('network down'); },
  });
  const editor = createWorklogDataCoreEditor({ client });
  await assert.rejects(
    () => editor.readDetails({ recordId }),
    (error) => error?.code === 'WORKLOG_DATA_CORE_EDIT_NETWORK_FAILED'
      && /네트워크/.test(error.message),
  );
});

test('PostgREST permission failures keep fail-closed ownership semantics', async () => {
  const client = createSupabaseDataCoreRestClient({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'publishable-key',
    accessToken: 'session-token',
    fetchImpl: async () => Response.json(
      { code: '42501', message: 'permission denied for function get_my_work_record_edit_v2' },
      { status: 403 },
    ),
  });
  const editor = createWorklogDataCoreEditor({ client });
  await assert.rejects(
    () => editor.readDetails({ recordId }),
    (error) => error?.code === 'WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN',
  );
});


test('versioned Data Core RPC names with numeric suffixes are allowed and reach PostgREST', async () => {
  const urls = [];
  const client = createSupabaseDataCoreRestClient({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'publishable-key',
    accessToken: 'session-token',
    fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json([{
        record_id: recordId,
        title_value: '기존 업무',
        due_at_value: null,
        due_has_time: false,
        action_kind_value: null,
        action_conversion_allowed: false,
      }]);
    },
  });
  const editor = createWorklogDataCoreEditor({ client });
  const details = await editor.readDetails({ recordId });
  assert.equal(details.recordId, recordId);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/rpc\/get_my_work_record_edit_v2$/);
});

test('unsafe RPC names remain rejected locally', async () => {
  const client = createSupabaseDataCoreRestClient({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'publishable-key',
    accessToken: 'session-token',
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  await assert.rejects(
    () => client.rpc('bad-name;drop', {}),
    (error) => error?.code === 'SUPABASE_DATA_CORE_RPC_INVALID',
  );
});
