import type { PlatformSupabaseClient } from '@/src/platform/supabase';
export type ReadonlyRepeatEvent={work_record_id:string;key:string;title:string;date:string;time:string;status:'pending'|'completed'|'skipped';editable:false;app_path:string};
/** ERP adapter contract: owner-filtered read only. Changes open worklog:// or worklog-qa:// + app_path. */
export async function readRepeatingMonth(client:Pick<PlatformSupabaseClient,'rpc'>,month:string):Promise<{events:ReadonlyRepeatEvent[];limited:boolean;readonly:true}> {
 if(!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('조회할 월을 확인해주세요.');
 const {data,error}=await client.rpc('get_my_repeating_work_month',{p_month:month+'-01'});
 if(error||!data||data.readonly!==true||!Array.isArray(data.events)||data.events.some((e:ReadonlyRepeatEvent)=>e.editable!==false))throw Error('반복 일정을 확인하지 못했습니다.');
 return data as {events:ReadonlyRepeatEvent[];limited:boolean;readonly:true};
}
