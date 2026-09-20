import type { PlatformSupabaseClient } from './supabase';

/**
 * Returns the current access token from Supabase Auth storage.
 * getSession() refreshes an expired session when needed, so mutations do not
 * depend on a possibly stale React session snapshot.
 */
export async function getFreshAccessToken(client: PlatformSupabaseClient) {
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error('로그인 세션을 갱신하지 못했습니다. 다시 로그인해주세요.');
  }
  const token = data.session?.access_token?.trim() || '';
  if (!token) {
    throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
  }
  return token;
}
