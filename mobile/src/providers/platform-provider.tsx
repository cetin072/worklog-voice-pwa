import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { AppState } from 'react-native';
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { loadRememberedLoginEmail, saveRememberedLoginEmail } from '@/src/platform/auth-preferences';
import { secureSessionStorage } from '@/src/platform/secure-storage';
import { loadPublicPlatformConfig, type PublicPlatformConfig } from '@/src/platform/config';
import {
  beginGoogleOAuth,
  completeGoogleOAuthFromUrl,
  isGoogleAuthCallbackUrl,
} from '@/src/platform/google-auth';
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
  authError: string;
  rememberedEmail: string;
  reload: () => void;
  clearAuthError: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<'signedIn' | 'confirmationRequired'>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const PlatformContext = createContext<PlatformContextValue | null>(null);

const ANDROID_TOUCH_SMOKE_MODE = process.env.EXPO_PUBLIC_ANDROID_TOUCH_SMOKE === '1';
const ANDROID_TOUCH_SMOKE_SESSION_KEY = 'worklog.mobile.qa.android-touch-session.v1';
const ANDROID_TOUCH_SMOKE_CONFIG: PublicPlatformConfig = {
  configured: true,
  supabaseUrl: 'https://android-touch-smoke.invalid',
  publishableKey: 'android-touch-smoke-publishable-key',
  dataCorePrimaryEnabled: true,
};
const ANDROID_TOUCH_SMOKE_SESSION = {
  access_token: 'android-touch-smoke-token',
  refresh_token: 'android-touch-smoke-refresh-token',
  expires_in: 3600,
  expires_at: 4_102_444_800,
  token_type: 'bearer',
  user: {
    id: 'android-touch-smoke-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'android-touch-smoke@example.invalid',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-09-21T00:00:00.000Z',
  },
} as Session;

async function seedAndroidTouchSmokeSession() {
  await secureSessionStorage.setItem(ANDROID_TOUCH_SMOKE_SESSION_KEY, JSON.stringify(ANDROID_TOUCH_SMOKE_SESSION));
}

function createAndroidTouchSmokeClient() {
  let listener: ((event: string, session: Session | null) => void) | null = null;
  return {
    auth: {
      async getSession() {
        const raw = await secureSessionStorage.getItem(ANDROID_TOUCH_SMOKE_SESSION_KEY);
        const session = raw ? JSON.parse(raw) as Session : null;
        console.info('[android-touch-smoke] platform-session-restored', { restored: Boolean(session) });
        return { data: { session }, error: null };
      },
      onAuthStateChange(callback: (event: string, session: Session | null) => void) {
        listener = callback;
        return { data: { subscription: { unsubscribe() { listener = null; } } } };
      },
      startAutoRefresh() {
        console.info('[android-touch-smoke] platform-auto-refresh=start');
      },
      stopAutoRefresh() {
        console.info('[android-touch-smoke] platform-auto-refresh=stop');
      },
      async signInWithPassword() { return { data: { session: ANDROID_TOUCH_SMOKE_SESSION }, error: null }; },
      async signUp() { return { data: { session: ANDROID_TOUCH_SMOKE_SESSION }, error: null }; },
      async signOut() {
        await secureSessionStorage.removeItem(ANDROID_TOUCH_SMOKE_SESSION_KEY);
        listener?.('SIGNED_OUT', null);
        return { error: null };
      },
    },
  } as unknown as PlatformSupabaseClient;
}

function authErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '로그인 처리 중 오류가 발생했습니다.';
}

export function PlatformProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<PlatformPhase>('loading');
  const [config, setConfig] = useState<PublicPlatformConfig | null>(null);
  const [client, setClient] = useState<PlatformSupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [rememberedEmail, setRememberedEmail] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    let activeClient: PlatformSupabaseClient | null = null;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let appStateSubscription: { remove: () => void } | null = null;
    let linkingSubscription: { remove: () => void } | null = null;

    setPhase('loading');
    setError('');

    void loadRememberedLoginEmail()
      .then((value) => {
        if (alive && value) setRememberedEmail(value);
      })
      .catch(() => undefined);

    void (async () => {
      try {
        if (ANDROID_TOUCH_SMOKE_MODE) {
          console.info('[android-touch-smoke] platform-phase=loading');
          await seedAndroidTouchSmokeSession();
        }
        const nextConfig = ANDROID_TOUCH_SMOKE_MODE ? ANDROID_TOUCH_SMOKE_CONFIG : await loadPublicPlatformConfig();
        const nextClient = ANDROID_TOUCH_SMOKE_MODE ? createAndroidTouchSmokeClient() : createPlatformSupabaseClient(nextConfig);
        activeClient = nextClient;

        const initialUrl = await Linking.getInitialURL();
        if (initialUrl && isGoogleAuthCallbackUrl(initialUrl)) {
          try {
            await completeGoogleOAuthFromUrl(nextClient, initialUrl);
            if (alive) setAuthError('');
          } catch (nextError) {
            if (alive) setAuthError(authErrorMessage(nextError));
          }
        }

        const { data, error: sessionError } = await nextClient.auth.getSession();
        if (sessionError) throw sessionError;
        if (!alive) return;

        setConfig(nextConfig);
        setClient(nextClient);
        setSession(data.session);
        if (data.session?.user.email) {
          setRememberedEmail(data.session.user.email);
          void saveRememberedLoginEmail(data.session.user.email).catch(() => undefined);
        }
        setPhase('ready');
        if (ANDROID_TOUCH_SMOKE_MODE) console.info('[android-touch-smoke] platform-phase=ready');

        const { data: authData } = nextClient.auth.onAuthStateChange((_event, nextSession) => {
          if (!alive) return;
          setSession(nextSession);
          if (nextSession?.user.email) {
            setRememberedEmail(nextSession.user.email);
            void saveRememberedLoginEmail(nextSession.user.email).catch(() => undefined);
          }
        });
        authSubscription = authData.subscription;

        linkingSubscription = Linking.addEventListener('url', ({ url }) => {
          if (!isGoogleAuthCallbackUrl(url)) return;
          void completeGoogleOAuthFromUrl(nextClient, url)
            .then(() => {
              if (alive) setAuthError('');
            })
            .catch((nextError) => {
              if (alive) setAuthError(authErrorMessage(nextError));
            });
        });

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
      linkingSubscription?.remove();
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
      authError,
      rememberedEmail,
      reload: () => setReloadKey((value) => value + 1),
      clearAuthError: () => setAuthError(''),
      signIn: async (email, password) => {
        if (!client) throw new Error('로그인 모듈이 아직 준비되지 않았습니다.');
        setAuthError('');
        const { error: signInError } = await client.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        setRememberedEmail(email);
        void saveRememberedLoginEmail(email).catch(() => undefined);
      },
      signUp: async (email, password) => {
        if (!client) throw new Error('로그인 모듈이 아직 준비되지 않았습니다.');
        setAuthError('');
        const { data, error: signUpError } = await client.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setRememberedEmail(email);
        void saveRememberedLoginEmail(email).catch(() => undefined);
        return data.session ? 'signedIn' : 'confirmationRequired';
      },
      signInWithGoogle: async () => {
        if (!client) throw new Error('로그인 모듈이 아직 준비되지 않았습니다.');
        setAuthError('');
        const result = await beginGoogleOAuth(client);
        if (result === 'cancelled') setAuthError('Google 로그인을 취소했습니다. 다른 방법으로 로그인할 수 있습니다.');
      },
      signOut: async () => {
        if (!client) return;
        setAuthError('');
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) throw signOutError;
      },
    }),
    [phase, config, client, session, error, authError, rememberedEmail],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const value = useContext(PlatformContext);
  if (!value) throw new Error('usePlatform must be used inside PlatformProvider.');
  return value;
}
