import { useState, type ReactNode } from 'react';
import { Pressable,StyleSheet,Text,View } from 'react-native';
import { mobileTheme } from '@/src/ui/theme';
export type ManagementArea='expenses'|'recurring'|'habits';
const labels:Record<ManagementArea,string>={expenses:'정기지출',recurring:'반복업무',habits:'습관'};
/** Three explicit areas, one entry. Each feature retains its own persistence and completion semantics. */
export function MyManagementScreen({expenses,recurring,habits,initialArea='expenses'}:{expenses:ReactNode;recurring:ReactNode;habits:ReactNode;initialArea?:ManagementArea}) {
 const [area,setArea]=useState<ManagementArea>(initialArea);
 return <View style={s.root}><View style={s.tabs}>{(Object.keys(labels) as ManagementArea[]).map(key=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:area===key}} style={[s.tab,area===key?s.selected:null]} onPress={()=>setArea(key)}><Text style={s.text}>{labels[key]}</Text></Pressable>)}</View>{area==='expenses'?expenses:area==='recurring'?recurring:habits}</View>;
}
const c=mobileTheme.colors;
const s=StyleSheet.create({root:{gap:12},tabs:{flexDirection:'row',flexWrap:'wrap',gap:8},tab:{flexGrow:1,flexBasis:80,minHeight:48,justifyContent:'center',alignItems:'center',paddingHorizontal:10,paddingVertical:10,borderWidth:1,borderColor:c.border,borderRadius:mobileTheme.radius.control},selected:{backgroundColor:c.todayBackground,borderColor:c.todayBorder},text:{fontSize:15,fontWeight:'700',color:c.text}});
