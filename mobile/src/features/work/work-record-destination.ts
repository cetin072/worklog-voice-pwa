import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { withRequestDeadline } from '@/src/platform/request-deadline';
import { seoulScheduleInstant } from '@/src/features/schedule/reminder-feedback';
export type WorkDestination = { kind: 'task' | 'note'; folderId: string | null };
export type ScheduledWorkRecord = { id: string; title: string; startsAt: string; status: 'confirmed'; allDay: false };
export type EditDestination = WorkDestination | { kind: 'schedule' };
export type DestinationSnapshot = { updatedAt: string; folderId: string | null; version: number };
function check(error: { code?: string; message?: string } | null, action = '업무로 변경') {
  if (!error) return;
  if (error.message === 'SCHEDULE_LINK_CONFLICT') throw Error('연결된 일정이 여러 개이거나 연결 정보가 달라 저장하지 못했습니다. 기존 일정을 확인해주세요.');
  if (error.message === 'INVALID_SCHEDULE') throw Error('일정 날짜와 시작 시간을 확인해주세요.');
  if (error.code === 'PT409') throw Error('다른 화면에서 기록이 변경됐습니다. 닫았다가 다시 열어주세요. 입력은 유지됩니다.');
  if (error.code === 'PGRST202' || error.code === '42883') throw Error(`${action} 기능의 서버 반영이 필요합니다. 기존 수정은 사용할 수 있습니다.`);
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

export async function scheduleWorkRecord(client: PlatformSupabaseClient, owner: string, id: string,
  title: string, date: string, time: string, snapshot: DestinationSnapshot): Promise<ScheduledWorkRecord> {
  let startsAt: string;
  try {
    if (date < '2000-01-01' || date > '2099-12-31') throw Error('INVALID_SCHEDULE');
    startsAt = seoulScheduleInstant(date, time);
  } catch {
    throw Error('일정 날짜와 시작 시간을 확인해주세요.');
  }

  const { data, error } = await withRequestDeadline(async signal => await client.rpc('schedule_my_work_record', {
    p_owner: owner, p_id: id, p_title: title.trim(), p_starts_at: startsAt, p_updated_at: snapshot.updatedAt,
  }).abortSignal(signal));
  check(error, '홈 일정 저장');
  const schedule = data?.schedule;
  if (data?.recordId !== id || !schedule || typeof schedule.id !== 'string' || !schedule.id ||
      schedule.status !== 'confirmed' || schedule.allDay !== false || schedule.title !== title.trim() ||
      typeof schedule.startsAt !== 'string' || Date.parse(schedule.startsAt) !== Date.parse(startsAt)) {
    throw Error('일정 저장을 확인하지 못했습니다. 홈 캘린더를 확인한 뒤 다시 시도해주세요.');
  }
  return schedule;
}
