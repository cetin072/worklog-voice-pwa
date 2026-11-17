import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const {voiceFolderMatches,organizeVoiceRecord}=await import('../mobile/src/features/work/voice-folder.ts');
const folders=[{id:'t',name:'테라리움',parent_id:null,version:0},{id:'s',name:'소금',parent_id:null,version:0}];
test('voice folders match exact names and particles without guessing similar words',()=>{
 for(const text of ['테라리움 주문 확인','테라리움에 주문 확인','테라리움을 준비','테라리움 폴더에 등록'])assert.deepEqual(voiceFolderMatches(text,folders).map(f=>f.id),['t']);
 assert.deepEqual(voiceFolderMatches('소금빵 발주',folders),[]);
 assert.deepEqual(voiceFolderMatches('테라류 주문',folders),[]);
 assert.equal(voiceFolderMatches('소금과 테라리움 준비',folders).length,2);
 assert.equal(voiceFolderMatches('소금 주문',[...folders,{...folders[1],id:'other',parent_id:'t'}]).length,2);
 assert.equal(voiceFolderMatches('A+B 확인',[{id:'x',name:'A+B'}]).length,1);
});
test('confirmed voice record is assigned once using owner and fresh-version guard',async()=>{
 const calls=[];const deps={loadFolders:async()=>folders,organizeRecord:async(...args)=>calls.push(args)};
 assert.match(await organizeVoiceRecord({},'owner','테라리움 주문','record',()=>true,deps),/테라리움 폴더에 저장/);
 assert.deepEqual(calls[0].slice(1),[{id:'record',organization_version:-1},{folder:'t'},'owner']);
 for(const text of ['일반 업무','소금과 테라리움 주문','소금 폴더에 넣지 마'])await organizeVoiceRecord({},'owner',text,'record',()=>true,deps);
 assert.equal(calls.length,1);
});
test('classification failures preserve the saved record and owner changes suppress writes/results',async()=>{
 let current=true,writes=0;
 const deps={loadFolders:async()=>folders,organizeRecord:async()=>{writes++;throw Error('conflict');}};
 assert.match(await organizeVoiceRecord({},'owner','소금 주문','record',()=>true,deps),/업무는 저장됐습니다/);assert.equal(writes,1);
 assert.equal(await organizeVoiceRecord({},'owner','소금 주문','record',()=>current,{...deps,loadFolders:async()=>{current=false;return folders;}}),'');assert.equal(writes,1);
 assert.equal(await organizeVoiceRecord({},'owner','소금 주문',undefined,()=>true,deps),'');
});
