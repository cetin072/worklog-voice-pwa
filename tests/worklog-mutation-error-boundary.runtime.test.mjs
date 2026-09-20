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
