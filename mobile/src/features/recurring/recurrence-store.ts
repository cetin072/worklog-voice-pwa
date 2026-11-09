import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { RepeatingWork, RepeatRevision, RepeatState } from './recurrence-model';
export type RepeatCommand = { op: 'create' | 'revise'; revision: RepeatRevision } | { op: 'pause' | 'resume' | 'end' } | { op: 'complete' | 'undo' | 'skip' | 'move' | 'next-date'; key: string; originalDate: string; dueDate?: string; title?: string; nextDate?: string };
const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
function fromRow(row: Record<string, unknown>): RepeatingWork {
  if (typeof row.work_record_id !== 'string' || !Number.isInteger(row.version) || !row.state || typeof row.state !== 'object') throw new Error('반복 업무 응답을 확인하지 못했습니다.');
  return { workRecordId: row.work_record_id, version: row.version as number, state: row.state as RepeatState };
}
export async function listRepeatingWork(client: PlatformSupabaseClient) {
  const { data, error } = await client.from('repeating_work').select('work_record_id,version,state').order('work_record_id').limit(500);
  if (error) throw new Error('반복 업무를 불러오지 못했습니다. 연결 또는 서버 준비 상태를 확인해주세요.');
  return (data || []).map(fromRow);
}
/** Retry the exact immutable command and UUID, including after ambiguous network failure. */
export async function mutateRepeatingWork(client: PlatformSupabaseClient, workRecordId: string, requestId: string, expectedVersion: number, command: RepeatCommand): Promise<RepeatingWork> {
  const { data: session } = await client.auth.getSession();
  const owner = session.session?.user.id;
  if (!owner) throw new Error('다시 로그인해주세요.');
  const current = async () => (await client.auth.getSession()).data.session?.user.id === owner;
  let result: Record<string, unknown> | null = null;
  try {
    const { data, error } = await client.rpc('mutate_repeating_work', { p_work_record_id: workRecordId, p_request_id: requestId, p_expected_version: expectedVersion, p_command: command });
    if (error?.code === '40001') throw new Error('VERSION_CONFLICT');
    if (!error && data) result = data as Record<string, unknown>;
  } catch (e) { if (e instanceof Error && e.message === 'VERSION_CONFLICT') throw new Error('다른 기기에서 변경됐습니다. 새로 불러온 뒤 다시 시도해주세요.'); }
  if (!await current()) throw new Error('계정이 바뀌어 처리를 중단했습니다.');
  if (!result) {
    const { data, error } = await client.from('repeating_work_requests').select('result,command,work_record_id').eq('request_id', requestId).maybeSingle();
    if (!error && data?.work_record_id === workRecordId && canonical(data.command) === canonical(command)) {
      if (data.result?.state) result=data.result as Record<string,unknown>;
      else {
        const row=await client.from('repeating_work').select('work_record_id,version,state').eq('work_record_id',workRecordId).maybeSingle();
        if(!row.error && row.data && row.data.version >= Number(data.result?.version))result=row.data;
      }
    }
  }
  if (!await current()) throw new Error('계정이 바뀌어 처리를 중단했습니다.');
  if (!result) throw new Error('저장 확인 필요 · 입력을 유지했습니다. 같은 요청으로 다시 시도해주세요.');
  return fromRow(result);
}
