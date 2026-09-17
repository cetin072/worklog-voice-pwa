import type { Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { loadPublicPlatformConfig, type PublicPlatformConfig } from '@/src/platform/config';
import {
  createPlatformSupabaseClient,
  type PlatformSupabaseClient,
} from '@/src/platform/supabase';

type PlatformPhase = 'loading' | 'ready' | 'error';

type PlatformContextValue = {
  phase: PlatformPhase;
  config: PublicPlatformConfig | null;
  client: PlatformSupabaseClient | null;
  session: Session | null;
  error: string;
  reload: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<PlatformPhase>('loading');
  const [config, setConfig] = useState<PublicPlatformConfig | null>(null);
  const [client, setClient] = useState<PlatformSupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    let activeClient: PlatformSupabaseClient | null = null;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let appStateSubscription: { remove: () => void } | null = null;

    setPhase('loading');
    setError('');

    void (async () => {
      try {
        const nextConfig = await loadPublicPlatformConfig();
        const nextClient = createPlatformSupabaseClient(nextConfig);
        activeClient = nextClient;

        const { data, error: sessionError } = await nextClient.auth.getSession();
        if (sessionError) throw sessionError;
        if (!alive) return;

        setConfig(nextConfig);
        setClient(nextClient);
        setSession(data.session);
        setPhase('ready');

        const { data: authData } = nextClient.auth.onAuthStateChange((_event, nextSession) => {
          if (alive) setSession(nextSession);
        });
        authSubscription = authData.subscription;

        if (AppState.currentState === 'active') nextClient.auth.startAutoRefresh();
        appStateSubscription = AppState.addEventListener('change', (state) => {
          if (state === 'active') nextClient.auth.startAutoRefresh();
          else nextClient.auth.stopAutoRefresh();
        });
      } catch (nextError) {
        if (!alive) return;
        setError(nextError instanceof Error ? nextError.message : '모바일 Platform 초기화에 실패했습니다.');
        setPhase('error');
      }
    })();

    return () => {
      alive = false;
      authSubscription?.unsubscribe();
      appStateSubscription?.remove();
      activeClient?.auth.stopAutoRefresh();
    };
  }, [reloadKey]);

  const value = useMemo<PlatformContextValue>(
    () => ({
      phase,
      config,
      client,
      session,
      error,
      reload: () => setReloadKey((value) => value + 1),
      signIn: async (email, password) => {
        if (!client) throw new Error('로그인 모듈이 아직 준비되지 않았습니다.');
        const { error: signInError } = await client.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      },
      signOut: async () => {
        if (!client) return;
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) throw signOutError;
      },
    }),
    [phase, config, client, session, error],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const value = useContext(PlatformContext);
  if (!value) throw new Error('usePlatform must be used inside PlatformProvider.');
  return value;
}
