import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';

import type { PublicPlatformConfig } from './config';
import { secureSessionStorage } from './secure-storage';

export function createPlatformSupabaseClient(config: PublicPlatformConfig) {
  // Routing guard only: Supabase still verifies signatures and authorization.
  // A callback from the old project must never send its JWT to the new one.
  const unifiedFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const token = /^Bearer\s+(.+)$/i.exec(headers.get('authorization') || '')?.[1];
    if (token && token !== config.publishableKey) {
      let issuer: unknown;
      try {
        const payload = (token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/');
        issuer = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).iss;
      }
      catch { throw new Error('WORKLOG_AUTH_PROJECT_MISMATCH'); }
      if (issuer !== config.supabaseUrl.replace(/\/$/, '') + '/auth/v1') {
        throw new Error('WORKLOG_AUTH_PROJECT_MISMATCH');
      }
    }
    return fetch(input, init);
  };
  return createClient(config.supabaseUrl, config.publishableKey, {
    ...(config.dataSchema === 'worklog' ? {db:{schema:'worklog'},global:{fetch:unifiedFetch}} : {}),
    auth: {
      storage: secureSessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export type PlatformSupabaseClient = ReturnType<typeof createPlatformSupabaseClient>;
