import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {nativeNodes,nativeWords} from './helpers/native-component-harness.mjs';
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
const source=readFileSync('mobile/app/index.tsx','utf8');
const ast=ts.createSourceFile('home.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let tabs;
function walk(node){if(ts.isJsxElement(node)&&node.openingElement.getText(ast).includes('styles.bottomTabs'))tabs=node.getText(ast);ts.forEachChild(node,walk);}
walk(ast);
test('actual bottom navigation has only Home/Work, calls guarded navigation and preserves safe-area dock clearance',()=>{
 assert.ok(tabs);
 const js=ts.transpileModule(`return (${tabs});`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 const visited=[];
 const scope={React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},View:'View',Text:'Text',Pressable:'Pressable',styles:{},screen:'work',insets:{bottom:20},setScreen:screen=>visited.push(screen)};
 const tree=new Function('scope',`with(scope){${js}}`)(scope);
 const buttons=nativeNodes(tree).filter(n=>n.props?.accessibilityRole==='tab');
 assert.deepEqual(buttons.map(n=>nativeWords(n).trim()),['홈','업무']);
 assert.equal(buttons[1].props.accessibilityState.selected,true);
 buttons.forEach(n=>n.props.onPress());assert.deepEqual(visited,['home','work']);
 assert.equal(tree.props.style[1].paddingBottom,20);
 assert.match(source,/if \(next !== 'home' && quickVoiceNavigation\.current\)/);
 assert.match(source,/bottom: 60 \+ Math\.max\(insets\.bottom, 8\)/);
 assert.match(source,/paddingBottom: QUICK_VOICE_LAYOUT\.dockReserveHeight \+ 60 \+ Math\.max\(insets\.bottom, 8\)/);
 assert.match(source,/onOpenManagement=\{\(\)=>\{setManagementReturn\('home'\);setScreen\('subscriptions'\);\}\}/);
});
