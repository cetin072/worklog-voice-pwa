import { getApiBaseUrl } from './config';

export type BriefingTask = {
  pageId?: string;
  title?: string;
  institution?: string;
  status?: string;
  dueKey?: string;
  daysOverdue?: number;
  daysUntil?: number;
  followUp?: string;
};

export type BriefingSchedule = {
  scheduleId?: string;
  title?: string;
  startsAt?: string;
  dateKey?: string;
  allDay?: boolean;
  status?: string;
  location?: string;
};

export type MobileBriefing = {
  today?: string;
  generatedAt?: string;
  counts?: Partial<Record<'overdue' | 'today' | 'upcoming' | 'undated' | 'total', number>>;
  structure?: Partial<Record<'overdue' | 'today' | 'upcoming' | 'undated', BriefingTask[]>>;
  schedules?: { today?: BriefingSchedule[]; upcoming?: BriefingSchedule[]; total?: number };
  scheduleEnabled?: boolean;
};

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
  return readJson(response) as Promise<MobileBriefing>;
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

export async function updateWorklogStatus(accessToken: string, recordId: string, status: '완료' | '진행중' | '대기' | '확인필요') {
  const response = await fetch(`${getApiBaseUrl()}/api/briefing-v2`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ recordId, status }),
  });
  return readJson(response);
}
