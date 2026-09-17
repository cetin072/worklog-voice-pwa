import { getApiBaseUrl } from './config';

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(body.error || `요청에 실패했습니다. (${response.status})`));
  }
  return body;
}

function requestId() {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function loadBriefing(accessToken: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/briefing-fast`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });
  return readJson(response);
}

export async function saveWorklog(accessToken: string, transcript: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      transcript,
      clientRequestId: requestId(),
      recordedAt: new Date().toISOString(),
    }),
  });
  return readJson(response);
}
