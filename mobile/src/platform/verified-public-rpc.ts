import type { PlatformSupabaseClient } from './supabase';
import type { PublicPlatformConfig } from './config';
import { getFreshAccessToken } from './authenticated-access';

export type VerifiedRpcAccess = {
  client: PlatformSupabaseClient;
  config: PublicPlatformConfig;
  ownerId: string;
  current(): boolean;
};

/** Calls public RPCs using the same verified Auth UUID as the worklog schema. */
export async function verifiedPublicRpc<T>(
  { client, config, ownerId, current }: VerifiedRpcAccess,
  name: string,
  body: Record<string, unknown>,
  errors: { ownerChanged: string; unavailable: string },
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  if (config.dataSchema !== 'worklog' || !current()) throw Error(errors.ownerChanged);
  const token = await getFreshAccessToken(client);
  const actor = await client.auth.getUser(token);
  if (!current() || actor.error || actor.data.user?.id !== ownerId) throw Error(errors.ownerChanged);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { apikey: config.publishableKey, authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!current()) throw Error(errors.ownerChanged);
    if (!response.ok) throw Error([value?.message, value?.code].filter(Boolean).join(' ') || errors.unavailable);
    return value as T;
  } finally {
    clearTimeout(timer);
  }
}
