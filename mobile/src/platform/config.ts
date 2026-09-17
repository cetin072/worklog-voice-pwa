export const DEFAULT_API_BASE_URL = 'https://worklog-voice-pwa.netlify.app';

export type PublicPlatformConfig = {
  configured: true;
  supabaseUrl: string;
  publishableKey: string;
  dataCorePrimaryEnabled: boolean;
};

function normalizeApiBaseUrl(value: string) {
  const raw = value.trim().replace(/\/$/, '');
  const parsed = new URL(raw);
  const localDevelopment = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !localDevelopment) {
    throw new Error('모바일 API 주소는 HTTPS여야 합니다.');
  }
  return parsed.origin;
}

export function getApiBaseUrl() {
  return normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL);
}

export async function loadPublicPlatformConfig(fetchImpl: typeof fetch = fetch): Promise<PublicPlatformConfig> {
  const response = await fetchImpl(`${getApiBaseUrl()}/api/supabase-auth-config`, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Platform 설정을 불러오지 못했습니다. (${response.status})`);
  }

  const body = (await response.json()) as Partial<PublicPlatformConfig> & { configured?: boolean };
  if (!body.configured || !body.supabaseUrl || !body.publishableKey) {
    throw new Error('Platform 로그인 설정이 아직 준비되지 않았습니다.');
  }

  return {
    configured: true,
    supabaseUrl: body.supabaseUrl,
    publishableKey: body.publishableKey,
    dataCorePrimaryEnabled: Boolean(body.dataCorePrimaryEnabled),
  };
}
