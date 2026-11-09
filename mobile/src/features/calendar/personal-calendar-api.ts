import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { PublicPlatformConfig } from '@/src/platform/config';
import { getFreshAccessToken } from '@/src/platform/authenticated-access';
export type PersonalCalendarEvent = {id: string;source: string;title: string;starts_at: string;ends_at: string|null;all_day: boolean;location: string|null;description: string;status: string;updated_at: string;editable: boolean};
export type CalendarMonth = {month: string;today: string;events: PersonalCalendarEvent[];limited: boolean};
export type CalendarAccess = {client: PlatformSupabaseClient;config: PublicPlatformConfig;ownerId: string;current(): boolean};
/** Same ERP RPCs and schedule IDs. Token pinned to verified owner, never a mirror. */
export async function personalCalendarRequest<T>(access: CalendarAccess,name: 'get_my_calendar_month'|'save_my_calendar_event'|'cancel_my_calendar_event',body: Record<string,unknown>,fetchImpl: typeof fetch=fetch): Promise<T> {
 const {client,config,ownerId,current}=access;
 if(config.dataSchema!=='worklog'||!current())throw Error('CALENDAR_OWNER_CHANGED');
 const token=await getFreshAccessToken(client),actor=await client.auth.getUser(token);
 if(!current()||actor.error||actor.data.user?.id!==ownerId)throw Error('CALENDAR_OWNER_CHANGED');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
 try {
  const r=await fetchImpl(config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:controller.signal,headers:{apikey:config.publishableKey,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
  const value=await r.json();if(!current())throw Error('CALENDAR_OWNER_CHANGED');if(!r.ok)throw Error(value.message||'CALENDAR_UNAVAILABLE');return value as T;
 }finally{clearTimeout(timer);}
}
export function personalCalendarMessage(error: unknown){
 const code=String(error);
 if(code.includes('CALENDAR_CONFLICT'))return '다른 화면에서 변경된 일정입니다. 입력은 유지했습니다. 닫고 새로고침해 비교해주세요.';
 if(code.includes('CALENDAR_INVALID_INPUT'))return '제목·날짜와 종료 시간을 확인해주세요.';
 if(code.includes('CALENDAR_REQUEST_REUSE'))return '앞선 저장 결과를 먼저 확인해주세요. 입력은 유지했습니다.';
 if(/PGRST202|does not exist/.test(code))return '공유 캘린더 준비 중입니다. 잠시 후 다시 열어주세요.';
 if(/FORBIDDEN|OWNER_CHANGED/.test(code))return '로그인 계정과 캘린더 권한을 다시 확인해주세요.';
 return '처리하지 못했습니다. 입력은 유지했습니다. 다시 시도해주세요.';
}

/** Month endpoint also includes today; hide that extra day outside the selected month. */
export function personalEventsForMonth(data: CalendarMonth|null,month: string) {
 const from=Date.parse(month+'-01T00:00:00+09:00');
 const next=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
 const to=Date.parse(next+'T00:00:00+09:00');
 return data?.events.filter(e=>e.source==='personal'&&Date.parse(e.starts_at)<to&&Math.max(Date.parse(e.ends_at||'')||0,Date.parse(e.starts_at)+1)>from)||[];
}
