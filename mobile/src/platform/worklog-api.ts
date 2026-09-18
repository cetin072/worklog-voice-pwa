import { getApiBaseUrl } from './config';
import type { PlatformSupabaseClient } from './supabase';

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

export type WorkRecordSearchStatus = 'completed' | 'in_progress' | 'waiting' | 'needs_review';

export type WorkRecordSearchResult = {
  workRecordId: string;
  title: string;
  snippet: string;
  institution: string;
  status: WorkRecordSearchStatus | string;
  recordedAt?: string;
  dueAt?: string;
  matchType?: string;
};

export type WorkRecordSearchPage = {
  items: WorkRecordSearchResult[];
  nextOffset: number;
  hasMore: boolean;
};

const RECORD_SEARCH_PAGE_SIZE = 50;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Searches all work records through the existing RLS-protected Supabase RPC.
 * This deliberately does not filter the briefing payload: completed and older
 * records stay searchable, while workspace isolation remains in the database.
 */
export async function searchMyWorkRecords(
  client: PlatformSupabaseClient,
  query: string,
  sourceOffset = 0,
  statuses: readonly string[] = [],
): Promise<WorkRecordSearchPage> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { items: [], nextOffset: 0, hasMore: false };
  }
  if (normalizedQuery.length > 120) {
    throw new Error('검색어는 120자 이하로 입력해 주세요.');
  }

  const { data, error } = await client.rpc('search_my_work_records', {
    p_query: normalizedQuery,
    p_limit: RECORD_SEARCH_PAGE_SIZE,
    p_offset: Math.max(0, sourceOffset),
  });
  if (error) {
    throw new Error(error.message || '과거 업무 검색에 실패했습니다.');
  }

  const rows = Array.isArray(data) ? data : [];
  const selectedStatuses = new Set(statuses);
  const items = rows.flatMap((row): WorkRecordSearchResult[] => {
    const value = asRecord(row);
    const workRecordId = asText(value?.work_record_id);
    if (!value || !workRecordId) return [];

    const status = asText(value.status);
    if (selectedStatuses.size > 0 && !selectedStatuses.has(status)) return [];

    return [{
      workRecordId,
      title: asText(value.title) || '제목 없는 업무',
      snippet: asText(value.snippet),
      institution: asText(value.institution),
      status,
      recordedAt: asText(value.recorded_at) || undefined,
      dueAt: asText(value.due_at) || undefined,
      matchType: asText(value.match_type) || undefined,
    }];
  });

  return {
    items,
    nextOffset: Math.max(0, sourceOffset) + rows.length,
    hasMore: rows.length === RECORD_SEARCH_PAGE_SIZE,
  };
}

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

export type SaveWorklogOptions = Readonly<{
  clientRequestId?: string;
  recordedAt?: string;
}>;

export type SavedWorklog = Readonly<{
  pageId?: string;
  dataCoreWorkRecordId?: string;
  cleanTranscript?: string;
  scheduleDetected?: boolean;
  scheduleId?: string;
  dueStart?: string;
}>;

function normalizedRecordedAt(value?: string) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('업무 기록 시각이 올바르지 않습니다.');
  }
  return date.toISOString();
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

export async function saveWorklog(
  accessToken: string,
  transcript: string,
  options: SaveWorklogOptions = {},
): Promise<SavedWorklog> {
  const normalizedTranscript = transcript.trim();
  if (!normalizedTranscript) throw new Error('저장할 업무 원문이 없습니다.');

  const clientRequestId = options.clientRequestId?.trim() || requestId();
  if (clientRequestId.length > 200) {
    throw new Error('업무 저장 요청 ID가 너무 깁니다.');
  }

  const response = await fetch(`${getApiBaseUrl()}/api/worklog`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      transcript: normalizedTranscript,
      clientRequestId,
      recordedAt: normalizedRecordedAt(options.recordedAt),
    }),
  });
  return readJson(response) as Promise<SavedWorklog>;
}

/** Reuses the canonical worklog edit endpoint for post-transcription correction. */
export async function updateWorklogTitle(accessToken: string, recordId: string, title: string) {
  const normalizedRecordId = recordId.trim();
  const normalizedTitle = title.trim();
  if (!normalizedRecordId) throw new Error('수정할 업무 식별자가 없습니다.');
  if (!normalizedTitle) throw new Error('수정할 업무 원문이 없습니다.');

  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ pageId: normalizedRecordId, title: normalizedTitle }),
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


export type WorklogEditDetails = {
  title: string;
  dueDate: string;
  dueTime: string;
  mode?: string;
};

export async function readWorklogDetails(accessToken: string, pageId: string): Promise<WorklogEditDetails> {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: 'read', pageId }),
  });
  const body = await readJson(response);
  return {
    title: typeof body.title === 'string' ? body.title : '',
    dueDate: typeof body.dueDate === 'string' ? body.dueDate : '',
    dueTime: typeof body.dueTime === 'string' ? body.dueTime : '',
    mode: typeof body.mode === 'string' ? body.mode : undefined,
  };
}

export async function updateWorklogDetails(
  accessToken: string,
  input: { pageId: string; title: string; dueDate: string; dueTime: string },
) {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      action: 'update',
      pageId: input.pageId,
      title: input.title,
      dueDate: input.dueDate,
      dueTime: input.dueTime,
    }),
  });
  return readJson(response);
}
