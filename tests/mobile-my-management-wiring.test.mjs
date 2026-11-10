import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
test('통합 Root는 기존 직접입력 한 개와 내 관리 한 개를 연결하고 세 영역의 데이터 UI를 섞지 않음',()=>{
 const ast=ts.createSourceFile('home.tsx',fs.readFileSync('mobile/app/index.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const nodes=[];function walk(n){if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))nodes.push(n);ts.forEachChild(n,walk)}walk(ast);
 assert.equal(nodes.filter(n=>n.tagName.getText(ast)==='ManualWorkInput').length,1,'QA merge로 직접입력 화면을 두 번 렌더링하면 실패');
 const management=nodes.filter(n=>n.tagName.getText(ast)==='MyManagementScreen');assert.equal(management.length,1);
 const source=management[0].getText(ast);assert.match(source,/expenses=\{<SubscriptionsScreen/);assert.match(source,/habits=\{<HabitsScreen/);assert.match(source,/recurring=\{/);
 assert.equal(nodes.filter(n=>n.attributes.properties.some(p=>p.name?.getText(ast)==='accessibilityLabel'&&p.initializer?.text==='내 관리 열기')).length,1);
});
