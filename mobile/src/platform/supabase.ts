import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

import type { PublicPlatformConfig } from './config';
import { secureSessionStorage } from './secure-storage';

export function createPlatformSupabaseClient(config: PublicPlatformConfig) {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      storage: secureSessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export type PlatformSupabaseClient = ReturnType<typeof createPlatformSupabaseClient>;
