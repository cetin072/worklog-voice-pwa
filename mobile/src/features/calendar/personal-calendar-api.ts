import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { PublicPlatformConfig } from '@/src/platform/config';
import { getFreshAccessToken } from '@/src/platform/authenticated-access';
export type PersonalCalendarEvent = {id: string;source: string;title: string;starts_at: string;ends_at: string|null;all_day: boolean;location: string|null;description: string;status: string;updated_at: string;editable: boolean};
export type CalendarMonth = {month: string;today: string;events: PersonalCalendarEvent[];limited: boolean;personalOnly?: boolean};
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
/** Read-only Worklog recovery. Normal workspaces still use PostgreSQL RLS;
 * this never requests ERP notices, other owners, or write access. */
export async function readHomeCalendarMonth(access: CalendarAccess, month: string, fetchImpl: typeof fetch = fetch): Promise<CalendarMonth> {
  try {
    return await personalCalendarRequest<CalendarMonth>(access, 'get_my_calendar_month', {p_month: month + '-01'}, fetchImpl);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'CALENDAR_FORBIDDEN') throw error;
  }
  const {client,config,ownerId,current}=access;
  if (config.dataSchema !== 'worklog' || !current()) throw Error('CALENDAR_OWNER_CHANGED');
  if (!/^(20[0-9]{2})-(0[1-9]|1[0-2])$/.test(month)) throw Error('CALENDAR_INVALID_MONTH');
  const token=await getFreshAccessToken(client), actor=await client.auth.getUser(token);
  if (!current() || actor.error || actor.data.user?.id !== ownerId) throw Error('CALENDAR_OWNER_CHANGED');
  const root=config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/';
  const headers={apikey:config.publishableKey,authorization:'Bearer '+token,'Accept-Profile':'worklog'};
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20_000);
  const get=async (table: string, params: URLSearchParams) => {
    if (!current()) throw Error('CALENDAR_OWNER_CHANGED');
    const response=await fetchImpl(root+table+'?'+params.toString(),{method:'GET',headers,signal:controller.signal,redirect:'error'});
    if (!current()) throw Error('CALENDAR_OWNER_CHANGED');
    if (!response.ok) throw Error('CALENDAR_FORBIDDEN');
    const rows=await response.json();
    if (!current()) throw Error('CALENDAR_OWNER_CHANGED');
    if (!Array.isArray(rows)) throw Error('CALENDAR_FORBIDDEN');
    return rows;
  };
  try {
    const workspaces=await get('workspaces',new URLSearchParams({select:'id',kind:'eq.personal',owner_user_id:'eq.'+ownerId,limit:'2'}));
    if (workspaces.length !== 1 || typeof workspaces[0]?.id !== 'string') throw Error('CALENDAR_FORBIDDEN');
    const membership=await get('workspace_members',new URLSearchParams({select:'role',workspace_id:'eq.'+workspaces[0].id,user_id:'eq.'+ownerId,role:'eq.owner',limit:'1'}));
    if (membership[0]?.role !== 'owner') throw Error('CALENDAR_FORBIDDEN');
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const today=['year','month','day'].map(type=>parts.find(part=>part.type===type)?.value).join('-');
    const start=month+'-01T00:00:00+09:00';
    const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10)+'T00:00:00+09:00';
    const todayStart=today+'T00:00:00+09:00';
    const todayEnd=new Date(Date.parse(today+'T00:00:00Z')+86_400_000).toISOString().slice(0,10)+'T00:00:00+09:00';
    const overlap=(lo:string,hi:string)=>'and(starts_at.lt.'+hi+',or(ends_at.gt.'+lo+',and(ends_at.is.null,starts_at.gte.'+lo+')))';
    const rows=await get('schedules',new URLSearchParams({
      select:'id,title,starts_at,ends_at,all_day,location,description,status,updated_at',
      workspace_id:'eq.'+workspaces[0].id,created_by_user_id:'eq.'+ownerId,status:'in.(confirmed,tentative)',
      or:'('+overlap(start,end)+','+overlap(todayStart,todayEnd)+')',order:'starts_at.asc,id.asc',limit:'1000'
    }));
    const events=rows.map(row=>({...row,source:'personal',editable:false}));
    return {month,today,events,limited:true,personalOnly:true};
  } finally {
    clearTimeout(timer);
  }
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
