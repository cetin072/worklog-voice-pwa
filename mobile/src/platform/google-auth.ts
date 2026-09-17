import 'react-native-url-polyfill/auto';

import * as Linking from 'expo-linking';

import type { PlatformSupabaseClient } from './supabase';

export const GOOGLE_AUTH_REDIRECT_URL = 'worklog://google-auth';

function parseGoogleAuthCallback(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'worklog:' || parsed.hostname !== 'google-auth') return null;

  const query = parsed.searchParams;
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const read = (key: string) => fragment.get(key) || query.get(key);

  return {
    accessToken: read('access_token'),
    refreshToken: read('refresh_token'),
    code: read('code'),
    error: read('error_description') || read('error'),
  };
}

export function isGoogleAuthCallbackUrl(url: string) {
  try {
    return Boolean(parseGoogleAuthCallback(url));
  } catch {
    return false;
  }
}

export async function beginGoogleOAuth(client: PlatformSupabaseClient) {
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: GOOGLE_AUTH_REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data.url) throw new Error('Google 로그인 주소를 만들지 못했습니다.');

  await Linking.openURL(data.url);
}

export async function completeGoogleOAuthFromUrl(client: PlatformSupabaseClient, url: string) {
  const callback = parseGoogleAuthCallback(url);
  if (!callback) return false;

  if (callback.error) {
    throw new Error(`Google 로그인을 완료하지 못했습니다. ${callback.error}`);
  }

  if (callback.accessToken && callback.refreshToken) {
    const { error } = await client.auth.setSession({
      access_token: callback.accessToken,
      refresh_token: callback.refreshToken,
    });
    if (error) throw error;
    return true;
  }

  if (callback.code) {
    const { error } = await client.auth.exchangeCodeForSession(callback.code);
    if (error) throw error;
    return true;
  }

  throw new Error('Google 로그인 결과에서 Supabase 세션을 확인하지 못했습니다.');
}
