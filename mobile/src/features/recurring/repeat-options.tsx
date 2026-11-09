import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileTheme } from '@/src/ui/theme';
import { REPEAT_LABEL, type RepeatRule } from './recurrence-model';

export function RepeatOptions({ value, anchor, disabled, onChange }: { value: RepeatRule | null; anchor: string; disabled?: boolean; onChange(rule: RepeatRule | null): void }) {
  const [open,setOpen] = useState(!!value);
  const change = (patch: Partial<RepeatRule>) => onChange({ kind:'weekly',interval:1,weekdays:[5],unit:'day',anchor,...value,...patch });
  return <View style={s.root}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded:open }} disabled={disabled} style={s.button} onPress={() => setOpen(!open)}><Text style={s.label}>반복 {value ? REPEAT_LABEL[value.kind] : '없음'} {open ? '⌃' : '⌄'}</Text></Pressable>
    {open ? <View style={s.root}><View style={s.row}>{(['none',...Object.keys(REPEAT_LABEL)] as const).map(kind => <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: kind === (value?.kind || 'none') }} style={[s.button,kind===(value?.kind||'none')?s.selected:null]} disabled={disabled} onPress={() => kind==='none'?onChange(null):change({kind:kind as RepeatRule['kind']})}><Text style={s.label}>{kind==='none'?'반복 없음':REPEAT_LABEL[kind as RepeatRule['kind']]}</Text></Pressable>)}</View>
      {value ? <><Text style={s.meta}>시작일 {anchor || '업무 날짜를 선택해주세요.'}</Text>
        {value.kind==='weekly' ? <View style={s.row}>{['월','화','수','목','금','토','일'].map((label,i) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`반복 ${label}요일`} accessibilityState={{selected:value.weekdays.includes(i+1)}} disabled={disabled} style={[s.button,value.weekdays.includes(i+1)?s.selected:null]} onPress={() => change({weekdays:value.weekdays.includes(i+1)?value.weekdays.filter(d=>d!==i+1):[...value.weekdays,i+1]})}><Text style={s.label}>{label}</Text></Pressable>)}</View> : null}
        <View style={s.row}><Text style={s.label}>간격</Text><TextInput accessibilityLabel="반복 간격" keyboardType="number-pad" editable={!disabled} value={String(value.interval)} style={s.input} onChangeText={text=>change({interval:Number(text)})}/><Text style={s.meta}>{value.kind==='weekly'?'주':value.kind==='monthly'?'개월':value.kind==='yearly'?'년':value.kind==='after-completion'?'실제 완료 후':'일'}</Text></View>
        {value.kind==='after-completion'?<View style={s.row}>{(['day','week'] as const).map(unit=><Pressable key={unit} disabled={disabled} accessibilityRole="button" style={[s.button,value.unit===unit?s.selected:null]} onPress={()=>change({unit})}><Text style={s.label}>{unit==='day'?'일 뒤':'주 뒤'}</Text></Pressable>)}</View>:null}
      </> : null}</View> : null}
  </View>;
}
const c=mobileTheme.colors;
const s=StyleSheet.create({root:{gap:8},row:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:6},button:{minHeight:48,paddingHorizontal:12,justifyContent:'center',borderWidth:1,borderColor:c.border,borderRadius:mobileTheme.radius.control},selected:{backgroundColor:c.todayBackground,borderColor:c.todayBorder},label:{fontSize:15,color:c.text},meta:{fontSize:13,color:c.textSecondary},input:{minWidth:65,minHeight:48,borderWidth:1,borderColor:c.border,borderRadius:12,paddingHorizontal:12,fontSize:16,color:c.text}});
