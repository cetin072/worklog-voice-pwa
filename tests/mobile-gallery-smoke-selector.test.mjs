import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('mobile/scripts/android-runtime-smoke.sh','utf8');
const fn=source.slice(source.indexOf('find_node_center() {'),source.indexOf('\nfind_quickstep_wait_center()'));
test('사진 smoke는 마이크에 가려진 본문 대신 같은 레이블의 마지막 활성 floating 버튼 선택',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worklog-selector-')),file=path.join(dir,'view.xml');
 try {
  fs.writeFileSync(file,'<hierarchy><node content-desc="사진 · 캡처 가져오기" enabled="true" bounds="[388,2061][694,2198]"/><node content-desc="음성 기록 시작" enabled="true" bounds="[388,1970][692,2274]"/><node content-desc="사진 · 캡처 가져오기" enabled="true" bounds="[780,2052][922,2194]"/></hierarchy>');
  const result=spawnSync('bash',['-c',fn+'\nfind_node_center "$1" "$2" last','qa',file,'사진 · 캡처 가져오기'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'851 2123');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('enabled="true"','enabled="false"'));
  assert.equal(spawnSync('bash',['-c',fn+'\nfind_node_center "$1" "$2" last','qa',file,'사진 · 캡처 가져오기']).status,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
