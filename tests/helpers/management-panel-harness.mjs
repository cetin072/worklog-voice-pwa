import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../mobile/package.json',import.meta.url))('typescript');
const source=readFileSync(new URL('../../mobile/app/index.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('index.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression;
function visit(node){
 if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='MyManagementScreen'){
  expression=node.attributes.properties.find(p=>p.name?.getText(ast)==='recurring')?.initializer?.expression;
 }
 ts.forEachChild(node,visit);
}
visit(ast);
if(!expression)throw Error('Missing production recurring panel');
const js=ts.transpileModule(`return (${expression.getText(ast)});`,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
export function managementPanel(context){
 const node=(type,props,...children)=>({type,props:{...props,children}});
 return new Function('scope',`with(scope){${js}}`)({
  React:{createElement:node},View:'View',Text:'Text',Button:'Button',Pressable:'Pressable',
  ...context,
 });
}

export function managementBackHandler(context){
 let effect;
 function find(node){
  if(ts.isExpressionStatement(node)&&node.getText(ast).startsWith('useEffect(')&&node.getText(ast).includes("'hardwareBackPress'"))effect=node.getText(ast);
  ts.forEachChild(node,find);
 }
 find(ast);
 if(!effect)throw Error('Missing production back handler');
 new Function('scope',`with(scope){${effect}}`)(context);
}
