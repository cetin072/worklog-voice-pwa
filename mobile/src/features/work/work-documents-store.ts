import { withRequestDeadline } from '@/src/platform/request-deadline';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { WorkScope } from './work-folders-store';

export const DOCUMENT_MAX_BYTES = 1024 * 1024;
export const DOCUMENT_PAGE_SIZE = 25;
export type WorkDocument = { id: string; folder_id: string | null; title: string; body: string; version: number };
export type DocumentSummary = Pick<WorkDocument, 'id' | 'folder_id' | 'title'> & { preview: string; updated_at: string };

function check(error: { code?: string } | null, conflict = '다른 곳에서 문서가 변경됐습니다. 입력한 본문을 복사한 뒤 문서를 다시 열어주세요.') {
  if (!error) return;
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(error.code || '')) throw new Error('문서 보관함은 서버 준비 중입니다.');
  if (error.code === 'PT409') throw new Error(conflict);
  if (error.code === '23503') throw new Error('선택한 폴더를 사용할 수 없습니다. 다른 폴더를 선택해주세요.');
  throw new Error('문서 요청 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
}

export async function listDocuments(client: PlatformSupabaseClient, owner: string, scope: WorkScope, query: string, offset: number) {
  const { data, error } = await withRequestDeadline(async signal => await client.rpc('list_my_work_documents', {
    p_owner: owner, p_all: scope === 'all', p_folder: scope === 'all' ? null : scope, p_query: query, p_offset: offset,
  }).abortSignal(signal));
  check(error);
  if (!Array.isArray(data)) throw new Error('문서 목록을 확인하지 못했습니다.');
  return { rows: data.slice(0, DOCUMENT_PAGE_SIZE) as DocumentSummary[], more: data.length > DOCUMENT_PAGE_SIZE };
}

export async function readDocument(client: PlatformSupabaseClient, owner: string, id: string): Promise<WorkDocument> {
  const { data, error } = await withRequestDeadline(async signal => await client.from('work_documents')
    .select('id,folder_id,title,body,version').eq('id', id).eq('user_id', owner).abortSignal(signal).single());
  check(error);
  if (!data) throw new Error('문서를 열 수 없습니다.');
  return data;
}

export async function saveDocument(client: PlatformSupabaseClient, owner: string, document: WorkDocument): Promise<WorkDocument> {
  if (!document.title.trim() || !document.body.trim()) throw new Error('제목과 본문을 입력해주세요.');
  // Count UTF-8 bytes without encoding the whole document or requiring browser APIs.
  let bytes = 0;
  for (const char of document.body) {
    const code = char.codePointAt(0)!;
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    if (bytes > DOCUMENT_MAX_BYTES) throw new Error('문서는 1MB까지 저장할 수 있습니다.');
  }
  const { data, error } = await withRequestDeadline(async signal => await client.rpc('save_my_work_document', {
    p_owner: owner, p_id: document.id, p_title: document.title, p_body: document.body,
    p_folder: document.folder_id, p_version: document.version,
  }).abortSignal(signal));
  check(error);
  if (!data || data.id !== document.id) throw new Error('저장 결과를 확인하지 못했습니다. 다시 시도해주세요.');
  return data;
}

export async function setDocumentDeleted(
  client: PlatformSupabaseClient, owner: string,
  document: Pick<WorkDocument, 'id' | 'version'>, deleted: boolean,
): Promise<number> {
  const { data, error } = await withRequestDeadline(async signal => await client.rpc('set_my_work_document_deleted', {
    p_owner: owner, p_id: document.id, p_version: document.version, p_deleted: deleted,
  }).abortSignal(signal));
  check(error, '다른 곳에서 문서가 변경됐습니다. 문서를 닫은 뒤 목록에서 다시 확인해주세요.');
  if (data !== document.version + 1) throw new Error('문서 변경을 확인하지 못했습니다. 다시 시도해주세요.');
  return data;
}
