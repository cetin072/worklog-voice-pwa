import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { readWorklogDetails, updateWorklogDetails, deleteWorklog } =
  await import('../mobile/src/platform/worklog-api.ts');
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const ast = ts.createSourceFile('home.tsx', readFileSync('mobile/app/index.tsx','utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found = '';
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.ok(found, 'missing actual Home handler: '+name);
  return found;
}
function compile(names, scope) {
  const js = ts.transpileModule(names.map(declaration).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('scope',
    'with(scope) { '+js+'; return { '+names.join(',')+' }; }')(scope);
}
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { resolve, promise };
}
function harness() {
  const history = { edits:[], deletes:[], alarms:[], messages:[], removed:[], refreshes:0, updated:[] };
  const scope = {
    session: { user: { id:'synthetic-owner' } }, client:{},
    editTaskId:'record-1', editTitle:'서류 확인 수정', editDate:'2030-01-05', editTime:'11:00',
    editActionKind:'task', editOriginalActionKind:'task', editActionConversionAllowed:false,
    editBusy:false, editLoading:false, editReady:true,
    editReadEpoch:{current:1}, editDetailsCache:{current:new Map()},
    taskBusyId:null, noteBusyId:null, taskStatusInFlight:{current:false},
    recordMutationInFlight:{current:false},
    reminderSessionEpoch:{ capture:()=>()=>true },
    getFreshAccessToken:async()=> 'fresh-token',
    updateWorklogDetails:async (_token,input)=>{
      history.edits.push(input);
      return { pageId:input.pageId,title:input.title,mode:'data_core' };
    },
    deleteWorklog:async (_client,id)=>{
      history.deletes.push(id);
      return {pageId:id,deleted:true,alreadyDeleted:false,cancelledScheduleIds:['schedule-1']};
    },
    synchronizeEditedWorklogReminder:async (_client,input)=>{
      history.alarms.push(['edit',input.recordId]);return 'linked';
    },
    cancelSavedScheduleReminders:async ids=>{history.alarms.push(['delete',...ids]);},
    reminderFailureMessage:e=>e instanceof Error?e.message:'notification error',
    setEditBusy(){},setEditReady(){},setEditStatus(){},setEditStatusTone(){},
    setEditTaskId(v){scope.editTaskId=v;},setSavedReminder(){},
    updateVisibleTaskTitle(id,title){history.updated.push([id,title]);},
    removeVisibleRecordForConversion(id){history.removed.push(id);},
    setSelectedTask(){},setNoteBusyId(){},setTaskBusyId(){},
    showMessage(text,tone){history.messages.push({text,tone});},
    clearMessage(){},refreshBriefing:async()=>{history.refreshes++;return true;},
    messageOf:(e,fallback)=>e instanceof Error?e.message:fallback,
  };
  return {scope,history,...compile(['saveTaskEditor','deleteBriefingRecord'],scope)};
}
test('rapid editor saves and competing delete trigger one write, one reminder sync and prompt close',async()=>{
  const h=harness(),barrier=gate();
  h.scope.updateWorklogDetails=async (_token,input)=>{
    h.history.edits.push(input);await barrier.promise;
    return {pageId:input.pageId,title:input.title,mode:'data_core'};
  };
  const first=h.saveTaskEditor();
  await h.saveTaskEditor();
  await h.deleteBriefingRecord('record-1','서류 확인','task');
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.history.edits.length,1);
  assert.equal(h.history.deletes.length,0);
  assert.equal(h.scope.recordMutationInFlight.current,true);
  barrier.resolve();await first;
  assert.equal(h.history.alarms.filter(x=>x[0]==='edit').length,1);
  assert.equal(h.history.refreshes,1);
  assert.equal(h.scope.editTaskId,null);
  assert.equal(h.scope.recordMutationInFlight.current,false);
  assert.match(h.history.messages[0].text,/업무 수정 저장/);
  assert.doesNotMatch(declaration('saveTaskEditor'),/setTimeout\(resolve, 420\)/);
});
test('rapid soft deletes call one owner RPC; native cancel failure remains warning after server success',async()=>{
  const h=harness(),barrier=gate();
  h.scope.deleteWorklog=async (_client,id)=>{
    h.history.deletes.push(id);await barrier.promise;
    return {pageId:id,deleted:true,alreadyDeleted:false,cancelledScheduleIds:['schedule-1']};
  };
  h.scope.cancelSavedScheduleReminders=async ids=>{
    h.history.alarms.push(['delete',...ids]);throw Error('synthetic native alarm unavailable');
  };
  const first=h.deleteBriefingRecord('record-1','서류 확인','task');
  await h.deleteBriefingRecord('record-1','서류 확인','task');
  await Promise.resolve();
  assert.deepEqual(h.history.deletes,['record-1']);
  barrier.resolve();await first;
  assert.deepEqual(h.history.removed,['record-1']);
  assert.deepEqual(h.history.alarms,[['delete','schedule-1']]);
  assert.equal(h.history.messages[0].tone,'info');
  assert.match(h.history.messages[0].text,/삭제했습니다/);
  assert.match(h.history.messages[0].text,/native alarm unavailable/);
  assert.equal(h.scope.recordMutationInFlight.current,false);
});
test('failed edit/delete releases lock without false success and permits retry',async()=>{
  const h=harness();
  h.scope.updateWorklogDetails=async()=>{throw Error('edit offline');};
  await h.saveTaskEditor();
  assert.equal(h.scope.recordMutationInFlight.current,false);
  assert.deepEqual(h.history.updated,[]);
  assert.equal(h.history.alarms.length,0);
  h.scope.deleteWorklog=async()=>{throw Error('delete offline');};
  await h.deleteBriefingRecord('record-1','서류 확인','task');
  assert.equal(h.scope.recordMutationInFlight.current,false);
  assert.deepEqual(h.history.removed,[]);
  assert.equal(h.history.messages.at(-1).tone,'error');
  h.scope.deleteWorklog=async (_client,id)=>({pageId:id,deleted:true,cancelledScheduleIds:[]});
  await h.deleteBriefingRecord('record-1','서류 확인','task');
  assert.deepEqual(h.history.removed,['record-1']);
});
test('read and edit API reject HTTP 200 without the exact owner-record ID',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    for(const body of [
      {ok:true,title:'orphan response',dueDate:'2030-01-05',dueTime:'11:00'},
      {ok:true,pageId:'other-record',title:'foreign title'},
      {ok:false,pageId:'record-1',title:'explicitly rejected'},
    ]){
      globalThis.fetch=async()=>Response.json(body);
      await assert.rejects(readWorklogDetails('token','record-1'),/업무 정보를 확인하지 못했습니다/);
      await assert.rejects(updateWorklogDetails('token',{
        pageId:'record-1',title:'서류 확인',dueDate:'2030-01-05',dueTime:'11:00',
      }),/수정 결과를 확인하지 못했습니다/);
    }
    globalThis.fetch=async()=>Response.json({
      ok:true,pageId:'record-1',title:'업무 수정',dueDate:'2030-01-05',dueTime:'11:00',
      schedule:{id:'schedule-1',title:'업무 수정',startsAt:'2030-01-05T11:00:00+09:00',status:'confirmed'},
    });
    assert.equal((await readWorklogDetails('token','record-1')).title,'업무 수정');
    const edited=await updateWorklogDetails('token',{
      pageId:'record-1',title:'업무 수정',dueDate:'2030-01-05',dueTime:'11:00',
    });
    assert.equal(edited.pageId,'record-1');
    assert.equal(edited.schedule.id,'schedule-1');
  }finally{globalThis.fetch=originalFetch;}
});
test('soft delete requires exact cancelled row before attempting device alarm cleanup',async()=>{
  let attempts=0;
  const client={rpc:async (_name,args)=>{
    attempts++;
    return {data:[{record_id:args.p_record_id,status_value:attempts===1?'active':'cancelled',
      already_cancelled:false,cancelled_schedule_ids:['schedule-1']}],error:null};
  }};
  await assert.rejects(deleteWorklog(client,'record-1'),/삭제할 업무를 찾지 못했거나/);
  const result=await deleteWorklog(client,'record-1');
  assert.equal(result.deleted,true);
  assert.deepEqual(result.cancelledScheduleIds,['schedule-1']);
});
