import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/platform-auth.js',import.meta.url),'utf8');
const sessionKey='worklogSupabaseSessionV1';
const token=project=>'header.'+Buffer.from(JSON.stringify({iss:`https://${project}.supabase.co/auth/v1`})).toString('base64url')+'.signature';
function fixture(project){
 const values=new Map([[sessionKey,JSON.stringify({access_token:token(project),refresh_token:'retained-original'})]]),calls=[];
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const window={location:{hash:'',pathname:'/',search:'',origin:'https://app.test'},history:{replaceState(){}}};
 vm.runInNewContext(source,{window,document:{title:''},localStorage:storage,sessionStorage:storage,URL,URLSearchParams,atob,fetch:async(u,o)=>{calls.push({u,o});return Response.json(u.startsWith('/api/')?{configured:true,supabaseUrl:'https://newproject.supabase.co',publishableKey:'public',dataSchema:'worklog'}:u.includes('/rpc/')?[{workspace_id:'space'}]:{id:'actor'});}});
 return {auth:window.WorklogPlatformAuth,calls,storage};
}
test('old-project web token and refresh token never leave browser during unified startup',async()=>{const {auth,calls,storage}=fixture('oldproject');assert.equal(await auth.currentUser(),null);await assert.rejects(auth.refreshSession());await assert.rejects(auth.bootstrapPersonalWorkspace());assert.equal(calls.length,1);assert.equal(JSON.parse(storage.getItem(sessionKey)).refresh_token,'retained-original');});
test('web uses worklog profile on REST and no profile on same-project Auth',async()=>{const {auth,calls}=fixture('newproject');assert.equal((await auth.currentUser()).id,'actor');assert.equal((await auth.bootstrapPersonalWorkspace()).workspaceId,'space');assert.equal(calls[1].o.headers['Accept-Profile'],undefined);assert.equal(calls[2].o.headers['Accept-Profile'],'worklog');assert.equal(calls[2].o.headers['Content-Profile'],'worklog');assert.equal(calls[1].o.headers.authorization,'Bearer '+token('newproject'));});
