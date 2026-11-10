import { recordRowStyles } from '@/src/ui/record-row-styles';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileTheme } from '@/src/ui/theme';
import { shiftDay } from '../home/home-calendar-model';
import { ManualWorkInput } from '../work/manual-work-input';
import { RepeatOptions } from './repeat-options';
import { repeatOccurrences, repeatHistory, repeatSummary, validDay, validateRule, type RepeatingWork, type RepeatOccurrence, type RepeatRule } from './recurrence-model';
import type { RepeatCommand } from './recurrence-store';

export function RecurringDetail({work,today,busy,onMutate,onClose,selected,focusDate}: {work:RepeatingWork;today:string;busy:boolean;onMutate(command:RepeatCommand):Promise<boolean>;onClose():void;selected?:RepeatOccurrence|null;focusDate?:string}) {
 const revision=work.state.revisions.at(-1)!;
 const [year,setYear]=useState(Number(selected?.dueDate.slice(0,4)||focusDate?.slice(0,4)||today.slice(0,4)));
 const [editing,setEditing]=useState<'single'|'future'|null>(null),[title,setTitle]=useState(selected?.title||revision.title),[date,setDate]=useState(selected?.dueDate||today),[rule,setRule]=useState<RepeatRule|null>(revision.rule),[error,setError]=useState('');
 const [time,setTime]=useState(selected?.time||revision.time);
 const [target,setTarget]=useState<RepeatOccurrence|null>(selected||null);
 const [next,setNext]=useState('');
 const rows=repeatOccurrences(work,`${year}-01-01`,`${year}-12-31`), summary=repeatSummary(repeatHistory(work,shiftDay(today,90)),today);
 const button=(label:string,action:()=>void,disabled=busy)=><Pressable accessibilityRole="button" disabled={disabled} style={s.button} onPress={action}><Text style={s.link}>{label}</Text></Pressable>;
 const send=async(command:RepeatCommand)=>{if(await onMutate(command)){setEditing(null);setError('');}};
 const command=(row:RepeatOccurrence,op:'complete'|'undo'|'skip'):RepeatCommand=>({op,key:row.key,originalDate:row.originalDate});
 const save=()=>{
  try {
   if(!validDay(date)||!title.trim()||(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))throw Error('invalid');
   if(editing==='single'&&target)void send({op:'move',key:target.key,originalDate:target.originalDate,dueDate:date,title:title.trim(),time});
   else if(rule){validateRule({...rule,anchor:date});Alert.alert('앞으로 전체 수정',`${date}부터 적용합니다. 이전 이력은 보존합니다.`,[{text:'취소',style:'cancel'},{text:'수정',onPress:()=>void send({op:'revise',revision:{...revision,from:date,title:title.trim(),time,rule:{...rule,anchor:date}}})}]);}
  }catch{setError('업무 이름·날짜·반복 주기를 확인해주세요.');}
 };
 const paused=work.state.pauses.some(p=>!p.to);
 return <View style={s.root}>
  <View style={s.row}><Text style={s.title}>{revision.title}</Text>{button('닫기',onClose,false)}</View>
  <Text style={s.meta}>전체 · 완료 {summary.completed} · 지난 미완료 {summary.missed} · 건너뜀 {summary.skipped}</Text>
  <Text style={s.meta}>마지막 완료 {summary.lastCompleted||'없음'} · 다음 예정 {summary.nextDate||'이 기간에 없음'}</Text>
  {work.state.endedOn?<Text style={s.meta}>{work.state.endedOn} 종료 · 이력 보존</Text>:<View style={s.row}>
   {button(paused?'재개':'일시중지',()=>void send({op:paused?'resume':'pause'}))}
   {button('앞으로 전체 수정',()=>{setTitle(revision.title);setDate(today>revision.from?today:shiftDay(revision.from,1));setRule(revision.rule);setTime(revision.time);setEditing('future');})}
   {button('반복 종료',()=>Alert.alert('반복 종료','미래 예정만 중단하고 지난 기록은 보존합니다.',[{text:'취소',style:'cancel'},{text:'종료',style:'destructive',onPress:()=>void send({op:'end'})}]))}
  </View>}
  {selected?<Text style={s.meta}>선택한 회차 {selected.dueDate}</Text>:null}
  {editing?<View style={s.card}>
   <Text style={s.meta}>{editing==='single'?'이번 회차만':'앞으로 전체'} 수정</Text>
   <ManualWorkInput value={{transcript:title,dueDate:date,dueTime:time}} busy={busy} onChange={v=>{setTitle(v.transcript);setDate(v.dueDate);setTime(v.dueTime);}} onSave={save}>
    {editing==='future'?<RepeatOptions value={rule} anchor={date} disabled={busy} onChange={setRule}/>:null}
   </ManualWorkInput>
   {button('수정 취소',()=>setEditing(null))}
  </View>:null}
  {error?<Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>:null}
  <View style={s.row}>{button('이전 해',()=>setYear(y=>y-1),busy||year<=1900)}{button('다음 해',()=>setYear(y=>y+1),busy||year>=2199)}</View>
  {rows.map(row=><View key={row.key} style={s.card}><Text style={s.title}>{row.title}</Text><Text style={s.meta}>{row.dueDate}{row.time?` ${row.time}`:''} · {row.status==='completed'?'완료':row.status==='skipped'?'건너뜀':row.dueDate<today?'지난 미완료':'예정'}</Text><View style={s.row}>
   {row.status==='pending'?<>{button('이번 회차 수정',()=>{setTarget(row);setTitle(row.title);setDate(row.dueDate);setTime(row.time);setEditing('single');})}{button('완료',()=>void send(command(row,'complete')))}{button('건너뛰기',()=>void send(command(row,'skip')))}</>:button('실행 취소',()=>void send(command(row,'undo')))}
  </View>{row.status==='skipped'&&revision.rule.kind==='after-completion'&&!row.nextDate?<View><TextInput accessibilityLabel="건너뛴 뒤 다음 예정일" value={next} placeholder="다음 날짜 YYYY-MM-DD" onChangeText={setNext} style={s.input}/>{button('다음 날짜 지정',()=>{if(validDay(next))void send({op:'next-date',key:row.key,originalDate:row.originalDate,nextDate:next});else setError('다음 날짜를 확인해주세요.');})}</View>:null}</View>)}
 </View>;
}
const c=mobileTheme.colors;
const s=StyleSheet.create({root:{gap:10},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8},card:{padding:14,gap:8,borderRadius:mobileTheme.radius.card,borderWidth:1,borderColor:c.border,backgroundColor:c.surface},title:{...recordRowStyles.taskTitle,flexShrink:1},meta:recordRowStyles.taskMeta,button:{minHeight:48,paddingHorizontal:12,justifyContent:'center',borderRadius:mobileTheme.radius.control,borderWidth:1,borderColor:c.border},link:{fontSize:15,color:c.link},input:{minHeight:48,paddingHorizontal:12,borderWidth:1,borderColor:c.border,borderRadius:12,fontSize:16,color:c.text},error:{fontSize:14,color:c.danger}});
