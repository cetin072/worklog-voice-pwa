import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { createReminderSyncEpoch } from '../schedule/schedule-reminder-snapshot';
import { seoulDate } from '../home/home-calendar-model';
import { syncRepeatReminders, cancelAllRepeatReminders, reconcileRepeatReminderOwner } from './recurrence-reminders';
import type { RepeatingWork } from './recurrence-model';
import { listRepeatingWork, mutateRepeatingWork, type RepeatCommand } from './recurrence-store';

export function useRepeatingWork(client: PlatformSupabaseClient | null, owner: string | undefined, ready = true) {
  const [works,setWorks] = useState<RepeatingWork[]>([]);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const [snapshotReady,setSnapshotReady] = useState(false);
  const [notificationError,setNotificationError] = useState('');
  const alive = useRef(true), flight = useRef(false);
  const reads = useRef(createReminderSyncEpoch());
  const attempt = useRef<{id:string;workId:string;version:number;command:RepeatCommand}|null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!owner) { void cancelAllRepeatReminders(); return; }
    let current = true;
    void reconcileRepeatReminderOwner(owner,()=>current).catch(()=>{
      if(current)setNotificationError('이전 계정 알림 정리 확인 필요');
    });
    return () => { current=false; };
  },[owner,ready]);

  useEffect(() => {
    // An empty initial state or failed read is not evidence that existing alarms should be removed.
    if (!ready || !snapshotReady || !owner) return;
    let current = true;
    void syncRepeatReminders(works,owner,seoulDate(),()=>current&&alive.current)
      .then(()=>{if(current)setNotificationError('');})
      .catch(()=>{if(current)setNotificationError('반복 업무 저장과 별개로 · 알림 확인 필요. 알림 설정을 확인해주세요.');});
    return () => { current=false; };
  },[works,owner,ready,snapshotReady]);

  const reload = useCallback(async () => {
    if (!ready || !client || !owner) return;
    const current = reads.current.begin();
    try {
      const next = await listRepeatingWork(client);
      if (!alive.current || !current()) return;
      setWorks(previous=>next.map(row=>{
        const known=previous.find(old=>old.workRecordId===row.workRecordId);
        return known&&known.version>row.version?known:row;
      }));
      setError(''); setLoaded(true); setSnapshotReady(true);
    } catch(e) {
      if(alive.current&&current()){setLoaded(true);setError(e instanceof Error?e.message:'반복 업무를 확인하지 못했습니다.');}
    }
  },[client,owner,ready]);

  useEffect(() => {
    alive.current=true;
    void reload();
    const sub=AppState.addEventListener('change',state=>{if(state==='active')void reload();});
    return ()=>{alive.current=false;reads.current.invalidate();sub.remove();};
  },[reload]);

  const mutate = async (workId:string,command:RepeatCommand) => {
    if (!ready || !client || flight.current) return false;
    if(attempt.current&&(attempt.current.workId!==workId||JSON.stringify(attempt.current.command)!==JSON.stringify(command))){
      setError('이전 저장 확인이 필요합니다. 먼저 같은 동작으로 다시 시도해주세요.');return false;
    }
    const a=attempt.current||{id:Crypto.randomUUID(),workId,version:works.find(w=>w.workRecordId===workId)?.version??-1,command};
    attempt.current=a;flight.current=true;setBusy(true);setError('');
    try {
      const saved=await mutateRepeatingWork(client,workId,a.id,a.version,a.command);
      attempt.current=null;reads.current.invalidate();
      if(alive.current)setWorks(rows=>{
        const known=rows.find(row=>row.workRecordId===saved.workRecordId);
        return known&&known.version>saved.version?rows:[...rows.filter(row=>row.workRecordId!==saved.workRecordId),saved];
      });
      if(!snapshotReady)await reload();
      return true;
    } catch(e) {
      if(alive.current)setError(e instanceof Error?e.message:'저장 확인 필요');
      if(e instanceof Error&&e.message.includes('다른 기기')){attempt.current=null;await reload();}
      return false;
    } finally {flight.current=false;if(alive.current)setBusy(false);}
  };
  return {works,loaded,error,notificationError,busy,reload,mutate,pending:!!attempt.current,
    retry:()=>attempt.current?mutate(attempt.current.workId,attempt.current.command):reload()};
}
