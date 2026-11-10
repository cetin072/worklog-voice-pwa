import { useCallback,useEffect,useRef,useState } from 'react';
import { Alert,AppState,Pressable,StyleSheet,Text,TextInput,View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { mobileTheme } from '@/src/ui/theme';
import { seoulDate,shiftDay } from '../home/home-calendar-model';
import { habitDue,habitProgress,validateHabit,weekStart,type Habit,type HabitCheck,type HabitDraft } from './habit-model';
import { loadHabits,mutateHabit,type HabitCommand } from './habit-store';
const labels={daily:'매일',weekdays:'지정 요일','weekly-target':'주 N회'} as const;
export function HabitsScreen({client}:{client:PlatformSupabaseClient}) {
 const [habits,setHabits]=useState<Habit[]>([]),[checks,setChecks]=useState<HabitCheck[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const [editing,setEditing]=useState<{id:string;draft:HabitDraft;version:number}|null>(null);
 const [clock,setClock]=useState(Date.now()),[notice,setNotice]=useState('');
 const alive=useRef(true),flight=useRef(false),attempt=useRef<{id:string;request:string;version:number;command:HabitCommand}|null>(null);
 const today=seoulDate(clock),monday=weekStart(today);
 const load=useCallback(async()=>{try{const result=await loadHabits(client,monday,shiftDay(monday,6));if(alive.current){setHabits(result.habits);setChecks(result.checks);setError('');setLoaded(true);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'불러오기 확인 필요');}},[client,monday]);
 useEffect(()=>{alive.current=true;void load();const sub=AppState.addEventListener('change',state=>{if(state==='active'){setClock(Date.now());void load();}});const timer=setInterval(()=>setClock(Date.now()),60000);return()=>{alive.current=false;sub.remove();clearInterval(timer);};},[load]);
 const send=async(id:string,version:number,command:HabitCommand)=>{
  if(flight.current)return false;
  if(attempt.current&&(attempt.current.id!==id||JSON.stringify(attempt.current.command)!==JSON.stringify(command))){setError('이전 저장 확인이 필요합니다. 같은 동작으로 다시 시도해주세요.');return false;}
  const a=attempt.current||{id,version,command,request:Crypto.randomUUID()};attempt.current=a;flight.current=true;setBusy(true);setError('');setNotice('');
  try{const saved=await mutateHabit(client,a.id,a.request,a.version,a.command);attempt.current=null;if(alive.current){if('habit_id'in saved)setChecks(rows=>[...rows.filter(r=>r.habit_id!==saved.habit_id||r.day!==saved.day),saved]);else setHabits(rows=>[...rows.filter(h=>h.id!==saved.id),saved]);setNotice('저장 확인됨');}return true;}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'저장 확인 필요');if(e instanceof Error&&e.message.includes('다른 기기')){attempt.current=null;await load();}return false;}
  finally{flight.current=false;if(alive.current)setBusy(false);}
 };
 const button=(label:string,press:()=>void,disabled=busy)=><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} style={[s.button,disabled?s.disabled:null]} onPress={press}><Text style={s.buttonText}>{label}</Text></Pressable>;
 const start=(habit?:Habit)=>{setError('');setNotice('');setEditing(habit?{id:habit.id,version:habit.version,draft:{name:habit.name,frequency:habit.frequency,weekdays:habit.weekdays,target:habit.target,start_date:habit.start_date}}:{id:Crypto.randomUUID(),version:-1,draft:{name:'',frequency:'daily',weekdays:[1,2,3,4,5],target:3,start_date:today}});};
 const patch=(p:Partial<HabitDraft>)=>setEditing(e=>e?{...e,draft:{...e.draft,...p}}:null);
 const save=async()=>{if(!editing)return;try{const draft=validateHabit(editing.draft);if(await send(editing.id,editing.version,{op:editing.version<0?'create':'update',draft}))setEditing(null);}catch(e){setError(e instanceof Error?e.message:'입력을 확인해주세요.');}};
 return <View style={s.root}>
  {error?<View><Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>{button(attempt.current?'저장 결과 다시 확인':'습관 다시 불러오기',()=>{const a=attempt.current;if(a)void send(a.id,a.version,a.command).then(ok=>{if(ok&&a.command.op!=='check')setEditing(null);});else void load();})}</View>:null}
  <Text accessibilityLiveRegion="polite" style={s.meta}>{busy?'저장 중…':notice}</Text>
  {editing?<View style={s.card}><Text style={s.title}>{editing.version<0?'습관 등록':'습관 수정'}</Text>
   <TextInput accessibilityLabel="습관 이름" editable={!busy} style={s.input} value={editing.draft.name} maxLength={60} placeholder="예: 운동, 독서" onChangeText={name=>patch({name})}/>
   <View style={s.row}>{(Object.keys(labels) as Habit['frequency'][]).map(f=><Pressable key={f} accessibilityRole="button" accessibilityState={{selected:editing.draft.frequency===f}} disabled={busy} style={[s.button,editing.draft.frequency===f?s.selected:null]} onPress={()=>patch({frequency:f})}><Text style={s.buttonText}>{labels[f]}</Text></Pressable>)}</View>
   {editing.draft.frequency==='weekdays'?<View style={s.row}>{['월','화','수','목','금','토','일'].map((label,i)=><Pressable key={label} disabled={busy} accessibilityRole="button" accessibilityLabel={`습관 ${label}요일`} accessibilityState={{selected:editing.draft.weekdays.includes(i+1)}} style={[s.button,editing.draft.weekdays.includes(i+1)?s.selected:null]} onPress={()=>patch({weekdays:editing.draft.weekdays.includes(i+1)?editing.draft.weekdays.filter(d=>d!==i+1):[...editing.draft.weekdays,i+1]})}><Text style={s.buttonText}>{label}</Text></Pressable>)}</View>:null}
   {editing.draft.frequency==='weekly-target'?<View><Text style={s.meta}>이번 주 목표 (1~7회)</Text><TextInput accessibilityLabel="습관 주간 목표" editable={!busy} keyboardType="number-pad" value={String(editing.draft.target)} onChangeText={v=>patch({target:Number(v)})} style={s.input}/></View>:null}
   <View style={s.row}>{button('습관 저장',()=>void save())}{button('취소',()=>setEditing(null))}</View>
   {editing.version>=0?button('습관 종료',()=>Alert.alert('습관 종료','지난 체크 기록은 보존하고 앞으로 표시를 중단합니다.',[{text:'취소',style:'cancel'},{text:'종료',style:'destructive',onPress:async()=>{if(await send(editing.id,editing.version,{op:'end'}))setEditing(null);}}])):null}
  </View>:<>
   <Text style={s.meta}>{monday} ~ {shiftDay(monday,6)} · 이번 주 달성</Text>
   {!loaded&&!error?<Text style={s.meta}>불러오는 중…</Text>:null}
   {habits.filter(h=>!h.archived_at).map(h=>{const p=habitProgress(h,checks,today),check=checks.find(c=>c.habit_id===h.id&&c.day===today);return <View key={h.id} style={s.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${h.name} 상세·수정`} style={s.nameButton} disabled={busy} onPress={()=>start(h)}><Text style={s.title}>{h.name}</Text><Text style={s.meta}>{labels[h.frequency]} · 이번 주 {p.count}/{p.target}회</Text></Pressable>
    {button(p.todayChecked?`${h.name} 오늘 체크 취소`:`${h.name} 오늘 체크`,()=>void send(h.id,check?.version??-1,{op:'check',day:today,checked:!p.todayChecked}),busy||!habitDue(h,today))}
    {!habitDue(h,today)?<Text style={s.meta}>오늘은 지정한 실천일이 아닙니다.</Text>:null}
   </View>;})}
   {loaded&&!habits.some(h=>!h.archived_at)?<Text style={s.meta}>한 번 등록하고 오늘 실천만 체크하세요. 빠진 날은 밀린 업무로 쌓이지 않습니다.</Text>:null}
   {button('+ 습관 등록',()=>start())}
  </>}
 </View>;
}
const c=mobileTheme.colors;
const s=StyleSheet.create({root:{gap:12},card:{backgroundColor:c.surface,borderWidth:1,borderColor:c.border,borderRadius:mobileTheme.radius.card,padding:mobileTheme.spacing.card,gap:10},row:{flexDirection:'row',flexWrap:'wrap',gap:8},title:{fontSize:15,lineHeight:21,fontWeight:'700',color:c.text},meta:{fontSize:13,lineHeight:18,color:c.textSecondary},nameButton:{minHeight:48,justifyContent:'center',gap:4},button:{minHeight:48,paddingHorizontal:12,borderRadius:mobileTheme.radius.control,borderWidth:1,borderColor:c.border,justifyContent:'center'},buttonText:{fontSize:15,color:c.text},selected:{backgroundColor:c.todayBackground,borderColor:c.todayBorder},disabled:{opacity:0.5},input:{minHeight:48,paddingHorizontal:12,fontSize:16,color:c.text,borderWidth:1,borderColor:c.border,borderRadius:mobileTheme.radius.control},error:{fontSize:14,color:c.danger}});
