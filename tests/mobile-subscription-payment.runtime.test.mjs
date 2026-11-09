import test from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const model = await import('../mobile/src/features/subscriptions/subscription-model.ts');
const store = await import('../mobile/src/features/subscriptions/subscription-store.ts');
const { mobileTheme } = await import('../mobile/src/ui/theme.ts');
const ts = createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree==='object' ? [tree,...nodes(tree.props?.children)] : [];
const words = tree => Array.isArray(tree) ? tree.map(words).join(' ') : tree && typeof tree==='object' ? words(tree.props?.children) : String(tree??'');
const draft = { name:'합성 서비스',amountText:'12000',cycle:'monthly',scope:'business',billingAnchorDate:'2026-11-15',cancelDeadline:'' };
function form() {
 const state=[];let cursor=0,saved;
 const React={createElement(type,props,...children){return typeof type==='function'?type({...props,children}):{type,props:{...props,children}};},useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];}};
 const native={Platform:{OS:'android'},StyleSheet:{create:s=>s},View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable'};
 const exp={};const js=ts.transpileModule(readFileSync('mobile/src/features/subscriptions/subscription-form.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('React','require','exports',js)(React,n=>n==='react'?React:n==='react-native'?native:n.includes('subscription-model')?model:n.includes('theme')?{mobileTheme}:{default:'DateTimePicker'},exp);
 const props={initial:{...draft,paymentMethod:'',paymentName:''},busy:false,isNew:true,onSave:v=>{saved=v;},onCancel(){}};
 return {render(){cursor=0;return exp.SubscriptionForm(props);},saved:()=>saved,draftFrom:exp.draftFromSubscription};
}
test('실제 구독 폼에서 카드명 입력·저장, 자동이체 변경 시 이전 카드명 제거',()=>{
 const h=form();const button=text=>nodes(h.render()).find(n=>n.type==='Pressable'&&words(n).trim()===text);
 assert.equal(nodes(h.render()).some(n=>n.props?.accessibilityLabel==='결제수단 이름'),false);
 button('카드').props.onPress();nodes(h.render()).find(n=>n.props?.accessibilityLabel==='결제수단 이름').props.onChangeText('삼성카드 · 업무용');
 button('저장').props.onPress();assert.equal(h.saved().paymentMethod,'card');assert.equal(h.saved().paymentName,'삼성카드 · 업무용');
 button('자동이체').props.onPress();assert.equal(nodes(h.render()).find(n=>n.props?.accessibilityLabel==='결제수단 이름').props.value,'');
 nodes(h.render()).find(n=>n.props?.accessibilityLabel==='결제수단 이름').props.onChangeText('국민은행 · 사업용');button('저장').props.onPress();assert.equal(h.saved().paymentMethod,'bank_transfer');
 button('미등록').props.onPress();button('저장').props.onPress();assert.equal(h.saved().paymentMethod,null);assert.equal(h.saved().paymentName,null);
});
test('서버 행·수정 초안·목록 표시까지 결제수단이 유지되고 미등록은 빈 표시',()=>{
 const row={id:'s1',name:'합성 서비스',amount_krw:12000,billing_cycle:'monthly',scope:'business',billing_anchor_date:'2026-11-15',payment_method:'card',payment_name:'삼성카드'};
 const sub=store.subscriptionFromRow(row);assert.equal(sub.paymentName,'삼성카드');assert.equal(form().draftFrom(sub,'2026-11-09','personal').paymentName,'삼성카드');
 assert.equal(model.subscriptionPaymentLabel(sub),'카드 · 삼성카드');assert.equal(model.subscriptionPaymentLabel({}),'');
 assert.equal(model.validateSubscriptionDraft({...draft,paymentMethod:'card',paymentName:'가'.repeat(61)}).ok,false);
});
test('선택 결제수단을 한 번의 저장 요청에 보내고 결제수단 변경·비우기도 전달',async()=>{
 let sent;
 const returned={id:'s1',name:'합성 서비스',amount_krw:12000,billing_cycle:'monthly',scope:'business',billing_anchor_date:'2026-11-15',payment_method:'card',payment_name:'삼성카드'};
 const b={select(){return b;},insert(v){sent=v;return b;},single:async()=>({data:returned,error:null})};
 const input=model.validateSubscriptionDraft({...draft,paymentMethod:'card',paymentName:'삼성카드'}).value;
 const sub=await store.createSubscription({from:()=>b},input);assert.equal(sent.payment_method,'card');assert.equal(sent.payment_name,'삼성카드');assert.equal(sub.paymentName,'삼성카드');assert.equal('user_id' in sent,false);
});
