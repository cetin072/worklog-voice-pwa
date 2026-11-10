import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { Habit,HabitCheck,HabitDraft } from './habit-model';
export type HabitCommand={op:'create'|'update';draft:HabitDraft}|{op:'end'}|{op:'check';day:string;checked:boolean};
export async function loadHabits(client:PlatformSupabaseClient,from:string,through:string) {
 const [habits,checks]=await Promise.all([client.from('habits').select('id,name,frequency,weekdays,target,start_date,archived_at,version').order('name').limit(500),client.from('habit_checks').select('habit_id,day,checked,version').gte('day',from).lte('day',through).limit(3500)]);
 if(habits.error||checks.error)throw Error('습관을 불러오지 못했습니다. 연결 또는 서버 준비 상태를 확인해주세요.');
 if(habits.data.length===500||checks.data.length===3500)throw Error('조회 범위를 초과했습니다. 모든 항목을 확인하지 못했습니다.');
 return {habits:habits.data as Habit[],checks:checks.data as HabitCheck[]};
}
const canonical=(v:unknown)=>JSON.stringify(v,(_k,o)=>o&&typeof o==='object'&&!Array.isArray(o)?Object.fromEntries(Object.keys(o).sort().map(k=>[k,o[k]])):o);
export async function mutateHabit(client:PlatformSupabaseClient,id:string,requestId:string,version:number,command:HabitCommand):Promise<Habit|HabitCheck> {
 const owner=(await client.auth.getSession()).data.session?.user.id;
 if(!owner)throw Error('다시 로그인해주세요.');
 let saved:Habit|HabitCheck|null=null;
 try {const {data,error}=await client.rpc('mutate_habit',{p_id:id,p_request_id:requestId,p_expected_version:version,p_command:command});if(error?.code==='40001')throw Error('CONFLICT');if(!error&&data)saved=data as Habit|HabitCheck;}
 catch(e){if(e instanceof Error&&e.message==='CONFLICT')throw Error('다른 기기에서 변경됐습니다. 새로 불러온 뒤 다시 시도해주세요.');}
 if((await client.auth.getSession()).data.session?.user.id!==owner)throw Error('계정이 바뀌어 처리를 중단했습니다.');
 if(!saved){const {data,error}=await client.from('habit_requests').select('habit_id,command,result').eq('request_id',requestId).maybeSingle();if(!error&&data?.habit_id===id&&canonical(data.command)===canonical(command))saved=data.result as Habit|HabitCheck;}
 if((await client.auth.getSession()).data.session?.user.id!==owner)throw Error('계정이 바뀌어 처리를 중단했습니다.');
 if(!saved)throw Error('저장 확인 필요 · 입력을 유지했습니다. 같은 동작으로 다시 시도해주세요.');
 return saved;
}
