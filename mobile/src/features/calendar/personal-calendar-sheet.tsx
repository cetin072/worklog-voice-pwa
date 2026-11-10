import {recordRowStyles} from '@/src/ui/record-row-styles';
import { recurringCalendarEvents } from '../recurring/recurrence-calendar';
import type { RepeatingWork } from '../recurring/recurrence-model';
import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Alert,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {usePlatform} from '@/src/providers/platform-provider';
import {mobileTheme} from '@/src/ui/theme';
import {personalCalendarRequest,personalCalendarMessage,personalEventsForMonth,type CalendarMonth,type PersonalCalendarEvent} from './personal-calendar-api';
const dateKey=(v: string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const timeKey=(v: string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
const shift=(v: string,n: number)=>new Date(Date.parse(v+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
type Draft={id: string;requestId: string;revision: string|null;title: string;date: string;time: string;endDate: string;endTime: string;location: string;description: string};
type Picker='date'|'time'|'endDate'|'endTime';
export function PersonalCalendarSheet({onClose,onSaved,initialDate,repeatingWorks=[],onOpenRepeating}: {repeatingWorks?: RepeatingWork[];onOpenRepeating?(id:string):void;onClose(): void;onSaved(): void;initialDate?: string}) {
 const {client,config,session}=usePlatform(),insets=useSafeAreaInsets();
 const live=useRef(true),sequence=useRef(0),flight=useRef(false),owner=session?.user.id;
 const [month,setMonth]=useState(()=>(initialDate||dateKey(new Date().toISOString())).slice(0,7));
 const [data,setData]=useState<CalendarMonth|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [draft,setDraft]=useState<Draft|null>(null),[dirty,setDirty]=useState(false),[picker,setPicker]=useState<Picker|null>(null),[expanded,setExpanded]=useState(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;sequence.current++;};},[]);
 const request=<T,>(name: Parameters<typeof personalCalendarRequest>[1],body: Record<string,unknown>)=>{
  if(!client||!config||!owner)throw Error('CALENDAR_OWNER_CHANGED');
  return personalCalendarRequest<T>({client,config,ownerId:owner,current:()=>live.current},name,body);
 };
 async function load(value=month){
  const seq=++sequence.current;setBusy(true);setMessage('');
  try{const next=await request<CalendarMonth>('get_my_calendar_month',{p_month:value+'-01'});if(live.current&&seq===sequence.current)setData(next);}
  catch(e){if(live.current&&seq===sequence.current)setMessage(personalCalendarMessage(e));}
  finally{if(live.current&&seq===sequence.current)setBusy(false);}
 }
 useEffect(()=>{setData(null);void load(month);},[month]);
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state==='active'&&!draft&&!flight.current)void load(month);});return()=>sub.remove();},[month,draft]);
 function close(){if(flight.current)return;if(draft&&dirty){Alert.alert('입력을 닫을까요?','저장하지 않은 입력이 있습니다.',[{text:'계속 입력',style:'cancel'},{text:'닫기',style:'destructive',onPress:()=>{setDraft(null);setPicker(null);setDirty(false);}}]);return;}if(draft){setDraft(null);setPicker(null);}else onClose();}
 function edit(row?: PersonalCalendarEvent){
  if(busy)return;setMessage('');setDirty(false);setExpanded(false);setPicker(null);
  setDraft({id:row?.id||Crypto.randomUUID(),requestId:Crypto.randomUUID(),revision:row?.updated_at||null,title:row?.title||'',date:row?dateKey(row.starts_at):initialDate?.startsWith(month)?initialDate:(month===dateKey(new Date().toISOString()).slice(0,7)?dateKey(new Date().toISOString()):month+'-01'),time:row&&!row.all_day?timeKey(row.starts_at):'',endDate:row?.ends_at?(row.all_day?shift(dateKey(row.ends_at),-1):dateKey(row.ends_at)):'',endTime:row?.ends_at&&!row.all_day?timeKey(row.ends_at):'',location:row?.location||'',description:row?.description||''});
 }
 function patch(value: Partial<Draft>){setDraft(d=>d?{...d,...value}:d);setDirty(true);}
 async function save(){
  if(!draft||flight.current)return;
  if(!draft.title.trim()||!draft.date||(draft.time&&draft.endDate&&!draft.endTime)){setMessage('제목·날짜와 종료 시간을 확인해주세요.');return;}
  flight.current=true;setBusy(true);setMessage('');
  try{
   const allDay=!draft.time;
   await request('save_my_calendar_event',{p_id:draft.id,p_request_id:draft.requestId,p_expected_updated_at:draft.revision,p_title:draft.title,p_starts_at:draft.date+'T'+(draft.time||'00:00')+':00+09:00',p_ends_at:allDay?shift(draft.endDate||draft.date,1)+'T00:00:00+09:00':draft.endTime?(draft.endDate||draft.date)+'T'+draft.endTime+':00+09:00':null,p_all_day:allDay,p_location:draft.location,p_description:draft.description});
   if(live.current){setDraft(null);setPicker(null);setDirty(false);onSaved();if(month!==draft.date.slice(0,7))setMonth(draft.date.slice(0,7));else await load();}
  }catch(e){if(live.current)setMessage(personalCalendarMessage(e));}
  finally{flight.current=false;if(live.current)setBusy(false);}
 }
 function remove(row: PersonalCalendarEvent){
  if(flight.current||busy)return;
  Alert.alert('개인 일정을 삭제할까요?',row.title,[{text:'취소',style:'cancel'},{text:'삭제',style:'destructive',onPress:async()=>{
   if(flight.current||!live.current)return;flight.current=true;setBusy(true);setMessage('');
   try{await request('cancel_my_calendar_event',{p_id:row.id,p_request_id:Crypto.randomUUID(),p_expected_updated_at:row.updated_at});if(live.current){onSaved();await load();}}
   catch(e){if(live.current)setMessage(personalCalendarMessage(e));}finally{flight.current=false;if(live.current)setBusy(false);}
  }}]);
 }
 const action=(label: string,onPress:()=>void,disabled=busy)=><Pressable accessibilityRole="button" disabled={disabled} style={[styles.button,disabled&&styles.disabled]} onPress={onPress}><Text style={styles.link}>{label}</Text></Pressable>;
 const field=(key: 'title'|'location'|'description',label: string,maxLength: number)=>draft?<View><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={draft[key]} onChangeText={text=>patch({[key]:text})} maxLength={maxLength} editable={!busy} multiline={key==='description'} style={styles.input}/></View>:null;
 const dateControl=(key: Picker,label: string)=>draft?<View><Text style={styles.label}>{label}</Text>{action(draft[key]||'선택',()=>setPicker(key))}</View>:null;
 let pickerValue=new Date();if(draft){const [y,m,d]=(picker==='endDate'?draft.endDate||draft.date:draft.date).split('-').map(Number);const [h,min]=(picker==='endTime'?draft.endTime||'09:00':draft.time||'09:00').split(':').map(Number);pickerValue=new Date(y,m-1,d,h,min);}
 const sourceIds=new Set(repeatingWorks.flatMap(w=>w.state.revisions.flatMap(r=>r.sourceScheduleIds||[r.sourceScheduleId]).filter(Boolean)));
 const events=[...personalEventsForMonth(data,month).filter(e=>!sourceIds.has(e.id)),...(repeatingWorks.length?recurringCalendarEvents(repeatingWorks,month):[])].sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
 return <Modal visible animationType="slide" onRequestClose={close}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={[styles.root,{paddingTop:insets.top+12,paddingBottom:insets.bottom+12}]}>
  <View style={styles.row}><Text style={styles.heading}>{draft?'내 일정 '+(draft.revision?'수정':'등록'):'내 캘린더'}</Text>{action(draft?'뒤로':'닫기',close)}</View>
  <Text style={styles.help}>ERP와 같은 개인 일정입니다. 업무·성과 기록을 만들지 않습니다.</Text>
  {message?<Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>:null}{busy?<ActivityIndicator/>:null}
  <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
   {draft?<>
    {field('title','제목',200)}{dateControl('date','날짜')}{dateControl('time','시작 시간 (선택)')}{draft.time?action('종일 일정으로 변경',()=>patch({time:'',endTime:''})):null}
    {action(expanded?'상세 접기':'종료 시간·장소·메모',()=>setExpanded(v=>!v))}
    {expanded?<>{dateControl('endDate','종료 날짜 (선택)')}{draft.time?dateControl('endTime','종료 시간 (선택)'):null}{action('종료 선택 지우기',()=>patch({endDate:'',endTime:''}))}{field('location','장소 (선택)',200)}{field('description','메모 (선택)',2000)}</>:null}
    {picker?<><DateTimePicker value={pickerValue} mode={picker==='time'||picker==='endTime'?'time':'date'} minimumDate={picker==='date'||picker==='endDate'?new Date(2000,0,1):undefined} maximumDate={picker==='date'||picker==='endDate'?new Date(2099,11,31):undefined} display={Platform.OS==='ios'?'spinner':'default'} onChange={(_,value)=>{if(Platform.OS!=='ios')setPicker(null);if(value){const date=`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`,time=`${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;patch({[picker]:picker==='time'||picker==='endTime'?time:date});}}}/>{Platform.OS==='ios'?action('선택 완료',()=>setPicker(null)):null}</>:null}
    {action('일정 저장',()=>void save())}
   </>:<>
    <View style={styles.row}>{action('이전 달',()=>setMonth(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-2,1)).toISOString().slice(0,7)),busy||month==='2000-01')}<Text>{month}</Text>{action('다음 달',()=>setMonth(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,7)),busy||month==='2099-12')}</View>
    <View style={styles.row}>{action('일정 등록',()=>edit())}{action('새로고침',()=>void load())}</View>
    {data?.limited?<Text style={styles.error}>일부 일정만 표시 중입니다.</Text>:null}{!busy&&!events.length?<Text>이번 달에 등록한 개인 일정이 없습니다.</Text>:null}
    {events.map(event=><View key={event.id} style={styles.event}><Text style={recordRowStyles.taskTitle}>{event.title}</Text><Text style={recordRowStyles.taskMeta}>{dateKey(event.starts_at)} · {event.all_day?'종일':timeKey(event.starts_at)}</Text>{event.location?<Text style={recordRowStyles.taskMeta}>{event.location}</Text>:null}{event.editable?<View style={styles.eventActions}><Pressable accessibilityRole="button" accessibilityLabel={`${event.title} 수정`} disabled={busy} style={recordRowStyles.inlineEdit} onPress={()=>edit(event)}><Text style={recordRowStyles.inlineEditText}>✏️</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${event.title} 삭제`} disabled={busy} style={recordRowStyles.inlineDelete} onPress={()=>remove(event)}><Text style={recordRowStyles.inlineDeleteText}>삭제</Text></Pressable></View>:event.id.startsWith('repeat:')?action('반복 업무 상세',()=>onOpenRepeating?.(event.id)):<Text style={styles.help}>연결된 업무에서 수정할 수 있습니다.</Text>}</View>)}
   </>}
  </ScrollView>
 </KeyboardAvoidingView></Modal>;
}
const styles=StyleSheet.create({eventActions:{flexDirection:'row',gap:6,alignSelf:'flex-end'},root:{flex:1,paddingHorizontal:20,backgroundColor:mobileTheme.colors.surface},content:{gap:14,paddingBottom:24},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8},heading:{fontSize:22,fontWeight:'700',flexShrink:1},label:{fontSize:16,fontWeight:'600',marginBottom:6},help:{color:mobileTheme.colors.textSecondary,marginVertical:10},error:{color:mobileTheme.colors.danger,marginVertical:10},input:{borderWidth:1,borderColor:mobileTheme.colors.border,borderRadius:12,padding:12,minHeight:48},button:{minHeight:46,paddingHorizontal:12,justifyContent:'center',borderWidth:1,borderColor:mobileTheme.colors.border,borderRadius:12},link:{color:mobileTheme.colors.link,fontWeight:'600'},disabled:{opacity:0.45},event:{paddingVertical:12,borderBottomWidth:1,borderColor:mobileTheme.colors.borderSubtle,gap:6}});
