import { useCallback, useEffect, useRef, useState } from 'react';
import { seoulDate } from '../home/home-calendar-model';
import { syncRepeatReminders, cancelAllRepeatReminders } from './recurrence-reminders';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { RepeatingWork } from './recurrence-model';
import { listRepeatingWork, mutateRepeatingWork, type RepeatCommand } from './recurrence-store';

export function useRepeatingWork(client: PlatformSupabaseClient | null, owner: string | undefined) {
  const [works,setWorks]=useState<RepeatingWork[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const alive=useRef(true),flight=useRef(false);
  const [notificationError,setNotificationError]=useState('');
  useEffect(()=>{if(!owner){void cancelAllRepeatReminders();return;}let current=true;void syncRepeatReminders(works,owner,seoulDate(),()=>current&&alive.current).then(()=>{if(current)setNotificationError('');}).catch(()=>{if(current)setNotificationError('반복 업무 저장과 별개로 · 알림 확인 필요. 알림 설정을 확인해주세요.');});return()=>{current=false;};},[works,owner]);
  const attempt=useRef<{id:string;workId:string;version:number;command:RepeatCommand}|null>(null);
  const reload=useCallback(async()=>{
    if (!client || !owner) return;
    try { const next=await listRepeatingWork(client);if(alive.current){setWorks(next);setError('');setLoaded(true);} }
    catch(e){if(alive.current){setLoaded(true);setError(e instanceof Error?e.message:'반복 업무를 확인하지 못했습니다.');}}
  },[client,owner]);
  useEffect(()=>{alive.current=true;void reload();const sub=AppState.addEventListener('change',s=>{if(s==='active')void reload();});return()=>{alive.current=false;sub.remove();};},[reload]);
  const mutate=async(workId:string,command:RepeatCommand)=>{
    if (!client || flight.current) return false;
    if(attempt.current && (attempt.current.workId!==workId || JSON.stringify(attempt.current.command)!==JSON.stringify(command))) {setError('이전 저장 확인이 필요합니다. 먼저 같은 동작으로 다시 시도해주세요.');return false;}
    const a=attempt.current || {id:Crypto.randomUUID(),workId,version:works.find(w=>w.workRecordId===workId)?.version??-1,command};
    attempt.current=a;flight.current=true;setBusy(true);setError('');
    try {const saved=await mutateRepeatingWork(client,workId,a.id,a.version,a.command);attempt.current=null;if(alive.current)setWorks(rows=>[...rows.filter(r=>r.workRecordId!==saved.workRecordId),saved]);return true;}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'저장 확인 필요');if(e instanceof Error&&e.message.includes('다른 기기')){attempt.current=null;await reload();}return false;}
    finally{flight.current=false;if(alive.current)setBusy(false);}
  };
  return {works,loaded,error,notificationError,busy,reload,mutate,pending:!!attempt.current,retry:()=>attempt.current?mutate(attempt.current.workId,attempt.current.command):reload()};
}
