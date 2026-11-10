import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeComponentHarness, nativeNodes, nativeWords } from './helpers/native-component-harness.mjs';
const theme={colors:{},size:{},radius:{}};
function editor() {
 return nativeComponentHarness('mobile/src/features/work/work-record-edit-sheet.tsx','WorkRecordEditSheet',{
  '@react-native-community/datetimepicker':{__esModule:true,default:'DateTimePicker'},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:0})},
  '@/src/ui/theme':{mobileTheme:theme},
 });
}
const props={visible:true,title:'Existing work',date:'2026-11-13',time:'14:30',loading:true,saving:false,ready:false,onTitle(){},onDate(){},onTime(){},onSave(){},onCancel(){}};
const byLabel=(tree,label)=>nativeNodes(tree).find(n=>n.props?.accessibilityLabel===label);
test('Home edit opens seeded fields for immediate typing/date picking, but cannot save before fresh owner read',()=>{
 const h=editor();const p={...props,allowTitleWhileLoading:true,allowFieldsWhileLoading:true};
 let tree=h.render(p);
 assert.equal(byLabel(tree,'수정할 업무명').props.value,'Existing work');
 assert.equal(byLabel(tree,'수정할 업무명').props.editable,true);
 assert.equal(byLabel(tree,'수정할 날짜 선택').props.disabled,false);
 assert.equal(byLabel(tree,'수정할 시간 선택').props.disabled,false);
 assert.match(nativeWords(tree),/14:30/);
 const save=()=>nativeNodes(tree).find(n=>n.type==='Pressable'&&nativeWords(n).trim()==='저장');
 assert.equal(save().props.disabled,true);
 byLabel(tree,'수정할 날짜 선택').props.onPress();
 tree=h.render(p);
 assert.equal(nativeNodes(tree).find(n=>n.type==='DateTimePicker').props.mode,'date');
 tree=h.render({...p,loading:false,ready:true});
 assert.equal(save().props.disabled,false);
 tree=h.render({...p,loading:false,statusText:'연결 확인 필요',statusTone:'error'});
 assert.equal(save().props.disabled,true,'failed fresh read never enables stale save');
});
test('shared edit sheet keeps callers without immediate-field opt-in guarded',()=>{
 const tree=editor().render(props);
 assert.equal(byLabel(tree,'수정할 업무명').props.editable,false);
 assert.equal(byLabel(tree,'수정할 날짜 선택').props.disabled,true);
 assert.equal(byLabel(tree,'수정할 시간 선택').props.disabled,true);
});
