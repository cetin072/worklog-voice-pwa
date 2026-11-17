import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { folderPath, loadFolders, organizeRecord, type WorkFolder } from './work-folders-store';

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
/** Exact names plus Korean particles; no fuzzy/AI guesses or substring matches. */
export function voiceFolderMatches(transcript: string, folders: WorkFolder[]) {
  const text = normalize(transcript);
  return folders.filter(folder => {
    const name = normalize(folder.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!name) return false;
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${name}(?=$|[^\\p{L}\\p{N}]|(?:에서|으로|에게|은|는|이|가|을|를|에|로|의|도|와|과)(?=$|[^\\p{L}\\p{N}]))`, 'u').test(text);
  });
}

/** Saving is already confirmed. Folder failure must never trigger another save.
 * Expected version -1 only permits a fresh organization row, preserving any
 * existing manual assignment on retries or concurrent edits. Server checks owner.
 */
export async function organizeVoiceRecord(client: PlatformSupabaseClient, owner: string, transcript: string,
  recordId: string | undefined, current: () => boolean,
  deps = { loadFolders, organizeRecord }): Promise<string> {
  if (!recordId || !current()) return '';
  try {
    const folders = await deps.loadFolders(client);
    if (!current()) return '';
    const matches = voiceFolderMatches(transcript, folders);
    if (!matches.length) return '일치하는 폴더 이름이 없어 자동 분류하지 않았습니다.';
    if (matches.length !== 1 || /말고|아니라|넣지|옮기지|분류하지|제외/.test(transcript)) return '폴더를 하나로 정하지 못했습니다. 업무 탭에서 확인해주세요.';
    await deps.organizeRecord(client, { id: recordId, organization_version: -1 }, { folder: matches[0].id }, owner);
    return current() ? `${folderPath(folders, matches[0].id)} 폴더에 저장했습니다.` : '';
  } catch {
    return current() ? '업무는 저장됐습니다. 폴더 분류는 업무 탭에서 확인해주세요.' : '';
  }
}
