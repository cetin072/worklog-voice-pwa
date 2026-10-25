import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const versionScript=resolve('scripts/prepare-play-version.mjs');
const manifestScript=resolve('scripts/verify-play-manifest.mjs');
test('Console code gate rejects missing/reused/invalid code without changing config',()=>{
 const dir=mkdtempSync(join(tmpdir(),'worklog-play-gate-'));
 try {mkdirSync(join(dir,'mobile'));const file=join(dir,'mobile/app.json');const source=JSON.stringify({expo:{android:{package:'com.cetin072.worklog',versionCode:1}}});
 for(const [highest,release] of [['',''],['2','2'],['3','2'],['2','2.5'],['2','2100000001']]){writeFileSync(file,source);const r=spawnSync(process.execPath,[versionScript],{cwd:dir,env:{...process.env,HIGHEST_CODE:highest,RELEASE_CODE:release}});assert.notEqual(r.status,0);assert.equal(readFileSync(file,'utf8'),source);}
 const r=spawnSync(process.execPath,[versionScript],{cwd:dir,env:{...process.env,HIGHEST_CODE:'7',RELEASE_CODE:'8'}});assert.equal(r.status,0);assert.equal(JSON.parse(readFileSync(file)).expo.android.versionCode,8);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('manifest gate executes against production identity/permissions and rejects QA/playback/old SDK',()=>{
 const dir=mkdtempSync(join(tmpdir(),'worklog-manifest-'));const file=join(dir,'AndroidManifest.xml');
 const valid='<manifest package="com.cetin072.worklog" android:versionCode="8"><uses-sdk android:targetSdkVersion="36"/>'+['RECORD_AUDIO','FOREGROUND_SERVICE_MICROPHONE','POST_NOTIFICATIONS','RECEIVE_BOOT_COMPLETED','SCHEDULE_EXACT_ALARM'].map(p=>`<uses-permission android:name="android.permission.${p}"/>`).join('')+'<service android:foregroundServiceType="microphone"/></manifest>';
 try {for(const [xml,ok] of [[valid,true],[valid.replace('versionCode="8"','versionCode="7"'),false],[valid.replace(' android:versionCode="8"',''),false],[valid.replace('worklog"','worklog.qa"'),false],[valid.replace('="36"','="35"'),false],[valid.replace('microphone"','mediaPlayback"'),false],[valid.replace('RECORD_AUDIO','FOREGROUND_SERVICE_MEDIA_PLAYBACK'),false]]){writeFileSync(file,xml);assert.equal(spawnSync(process.execPath,[manifestScript,file],{env:{...process.env,RELEASE_CODE:"8"}}).status===0,ok);}}finally{rmSync(dir,{recursive:true,force:true});}
});
