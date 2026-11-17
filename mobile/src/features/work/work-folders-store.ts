import { withRequestDeadline } from '@/src/platform/request-deadline';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type WorkFolder = { id: string; name: string; parent_id: string | null; version: number; task_count?: number };
export type FolderRecord = {
  id: string; title: string; content: string; original_text: string; status: string;
  action_kind: string | null; due_at: string | null; completed_at: string | null;
  briefing_state?: string; acknowledged_at?: string | null;
  folder_id: string | null; selected_on: string | null; organization_version: number;
  next_attention_at: string | null;
};
export type WorkSection = 'tasks' | 'notes' | 'completed';
export const PAGE_SIZE = 50;
export type WorkScope = 'all' | string | null;
export type WorkOverview = { folders: WorkFolder[]; records: FolderRecord[]; all_tasks: number; unclassified_tasks: number; total_count: number };
export async function loadWorkOverview(client: PlatformSupabaseClient, scope: WorkScope, section: WorkSection, offset = 0): Promise<WorkOverview> {
  const { data, error } = await withRequestDeadline(async signal => await client.rpc('get_my_work_overview', {
    p_all: scope === 'all', p_folder: scope === 'all' ? null : scope, p_section: section, p_offset: offset,
  }).abortSignal(signal));
  check(error);
  if (!data || !Array.isArray(data.folders) || !Array.isArray(data.records) || !Number.isFinite(data.total_count)) throw new Error('업무 응답을 확인하지 못했습니다.');
  return data;
}
export function folderPath(folders: WorkFolder[], id: string | null): string {
  const parts: string[] = [], seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find(item => item.id === id);
    if (!folder) break;
    parts.unshift(folder.name); id = folder.parent_id;
  }
  return parts.join(' / ') || '미분류';
}
export function canMoveFolder(folders: WorkFolder[], source: string, target: string | null) {
  const seen = new Set<string>();
  while (target) {
    if (target === source || seen.has(target)) return false;
    seen.add(target);
    const folder = folders.find(item => item.id === target);
    if (!folder) return false;
    target = folder.parent_id;
  }
  return true;
}
function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(error.code || '')) {
    throw new Error('개인 폴더 기능은 서버 준비 중입니다. 기존 입력·홈·업무일지는 계속 사용할 수 있습니다.');
  }
  if (error.code === 'PT409' || error.code === '40001') throw new Error('다른 화면에서 변경됐습니다. 새로고침 후 다시 시도해주세요.');
  throw new Error('폴더 처리를 확인하지 못했습니다. 입력은 유지됩니다. 새로고침 후 확인해주세요.');
}
export async function loadFolders(client: PlatformSupabaseClient): Promise<WorkFolder[]> {
  const { data, error } = await withRequestDeadline(async signal => await client.rpc('list_my_work_folders').abortSignal(signal));
  check(error);
  if (!Array.isArray(data)) throw new Error('폴더 응답을 확인하지 못했습니다.');
  return data;
}
export async function saveFolder(client: PlatformSupabaseClient, folder: WorkFolder, owner: string) {
  const { error } = await withRequestDeadline(async signal => await client.rpc('save_my_work_folder', { p_owner: owner, p_id: folder.id, p_name: folder.name.trim(), p_parent: folder.parent_id, p_version: folder.version }).abortSignal(signal));
  check(error);
}
export async function organizeRecord(client: PlatformSupabaseClient, record: Pick<FolderRecord, 'id' | 'organization_version'>, command: { folder: string | null } | { today: boolean }, owner: string) {
  const { error } = await withRequestDeadline(async signal => await client.rpc('organize_my_work_record', { p_owner: owner, p_id: record.id, p_version: record.organization_version, p_command: command }).abortSignal(signal));
  check(error);
}
