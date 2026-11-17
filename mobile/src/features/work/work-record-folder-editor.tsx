import { useEffect, useRef, useState } from 'react';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { reminderSessionEpoch } from '@/src/features/schedule/schedule-reminder-snapshot';
import { cancelSavedScheduleReminders } from '@/src/features/schedule/schedule-reminder-post-save';
import { WorkRecordEditSheet, type WorkRecordEditSheetProps } from './work-record-edit-sheet';
import { loadFolders, type WorkFolder } from './work-folders-store';
import { moveWorkDestination, readDestination, type WorkDestination, type DestinationSnapshot } from './work-record-destination';

type Props = WorkRecordEditSheetProps & {
  client?: PlatformSupabaseClient | null; recordId?: string | null; ownerId: string;
  onMoved(message: string, destination: WorkDestination): void;
};
// Keeps the ordinary editor unchanged. Explicit destination changes use one atomic RPC.
export function WorkRecordFolderEditor({ client, recordId, ownerId, onMoved, ...props }: Props) {
  const [folders,setFolders] = useState<WorkFolder[]>([]);
  const [snapshot,setSnapshot] = useState<DestinationSnapshot | null>(null);
  const [destination,setDestination] = useState<WorkDestination | null>(null);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState('');
  const [committed,setCommitted] = useState(false);
  const active = useRef(true), locked = useRef(false);
  useEffect(() => {
    active.current=true; let current=true;
    setDestination(null); setSnapshot(null); setMessage(''); setCommitted(false);
    if (props.visible && client && recordId) {
      void Promise.all([readDestination(client,recordId),loadFolders(client)]).then(([record,rows])=>{
        if (current) { setSnapshot(record); setFolders(rows); }
      }).catch(error=>{ if(current) setMessage(error instanceof Error ? error.message : '업무 전환 정보를 불러오지 못했습니다.'); });
    }
    return ()=>{current=false;active.current=false;};
  },[client,recordId,ownerId,props.visible]);
  async function save() {
    if (!destination) { props.onSave(); return; }
    if (!client || !recordId || !snapshot || locked.current || committed || props.saving || !props.ready) return;
    locked.current=true;setSaving(true);setMessage('');
    const guard=reminderSessionEpoch.capture();
    try {
      const ids=await moveWorkDestination(client,ownerId,recordId,props.title,destination,snapshot);
      if(!active.current || !guard()) return;
      setCommitted(true);
      let warning='';
      try { await cancelSavedScheduleReminders(ids,guard); }
      catch { warning=' 이 기기 알림 정리는 확인이 필요합니다.'; }
      if(!active.current || !guard()) return;
      onMoved(`${destination.kind==='task'?'할 일':'메모·자료'}로 변경했습니다.${warning} 구글에 전송한 일정은 구글 캘린더에서 별도로 확인해주세요.`, destination);
    } catch(error) {
      if(active.current && guard()) setMessage(error instanceof Error ? error.message : '변경을 확인하지 못했습니다. 입력은 유지됩니다.');
    } finally { locked.current=false;if(active.current)setSaving(false); }
  }
  return <WorkRecordEditSheet {...props}
    saving={props.saving || saving} ready={props.ready && !committed}
    statusText={message || props.statusText} statusTone={message?'error':props.statusTone}
    folderDestination={snapshot ? { value:destination, folders, onChange:(kind)=>setDestination(kind ? {kind,folderId:destination ? destination.folderId : snapshot.folderId} : null), onFolder:(folderId)=>setDestination(current=>current?{...current,folderId}:null) } : undefined}
    onSave={()=>void save()} />;
}
