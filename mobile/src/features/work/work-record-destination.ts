import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { withRequestDeadline } from '@/src/platform/request-deadline';
export type WorkDestination = { kind: 'task' | 'note'; folderId: string | null };
export type DestinationSnapshot = { updatedAt: string; folderId: string | null; version: number };
function check(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === 'PT409') throw Error('다른 화면에서 기록이 변경됐습니다. 닫았다가 다시 열어주세요. 입력은 유지됩니다.');
  if (error.code === 'PGRST202' || error.code === '42883') throw Error('업무로 변경 기능의 서버 반영이 필요합니다. 기존 수정은 사용할 수 있습니다.');
  throw Error('업무 변경을 확인하지 못했습니다. 입력을 유지했습니다. 목록을 확인한 뒤 다시 시도해주세요.');
}
export async function readDestination(client: PlatformSupabaseClient, id: string): Promise<DestinationSnapshot | null> {
  const {data,error} = await withRequestDeadline(async signal => await client.rpc('get_my_work_record_destination',{p_id:id}).abortSignal(signal));
  check(error);
  if (data === null) return null;
  if (!data || typeof data.updatedAt !== 'string' || !Number.isInteger(data.version)) throw Error('기록 정보를 확인하지 못했습니다.');
  return data;
}
export async function moveWorkDestination(client: PlatformSupabaseClient, owner: string, id: string, title: string, destination: WorkDestination, snapshot: DestinationSnapshot): Promise<string[]> {
  const {data,error} = await withRequestDeadline(async signal => await client.rpc('move_my_work_record_to_folder',{
    p_owner:owner,p_id:id,p_title:title.trim(),p_kind:destination.kind,p_folder:destination.folderId,p_updated_at:snapshot.updatedAt,p_version:snapshot.version,
  }).abortSignal(signal));
  check(error);
  if (data?.recordId !== id || !Array.isArray(data.cancelledScheduleIds) || !data.cancelledScheduleIds.every((v: unknown)=>typeof v==='string')) throw Error('저장 응답을 확인하지 못했습니다. 다시 저장하기 전에 목록을 확인해주세요.');
  return data.cancelledScheduleIds;
}
