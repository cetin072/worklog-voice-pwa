import { useState } from 'react';
import { Text, View } from 'react-native';
import { ManualWorkInput, type ManualWorkInputValue } from '../work/manual-work-input';
import { RepeatOptions } from './repeat-options';
import { newRepeatState, type RepeatRule, type RepeatRevision } from './recurrence-model';
export function RepeatFromRecord({initial,busy,onSave}: {initial:ManualWorkInputValue;busy:boolean;onSave(revision:RepeatRevision):Promise<boolean>}) {
 const [value,setValue]=useState(initial),[rule,setRule]=useState<RepeatRule|null>({kind:'weekly',anchor:initial.dueDate,interval:1,weekdays:[5],unit:'day'}),[error,setError]=useState('');
 const save=async()=>{try{if(!rule)throw Error('empty');const state=newRepeatState(value.transcript,{...rule,anchor:value.dueDate},value.dueTime);await onSave(state.revisions[0]);}catch{setError('반복 주기·요일·시작일을 확인해주세요.');}};
 return <View><Text>기존 업무 원본에 반복을 연결합니다.</Text><ManualWorkInput value={value} busy={busy} onChange={setValue} onSave={()=>void save()}><RepeatOptions value={rule} anchor={value.dueDate} disabled={busy} onChange={setRule}/></ManualWorkInput>{error?<Text accessibilityLiveRegion="polite">{error}</Text>:null}</View>;
}
