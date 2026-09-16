import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeWorklogTitle, validWorklogPageId } from "../netlify/shared/worklog-edit.mjs";
import { createWorklogDataCoreTitleEditor } from "../netlify/shared/worklog-data-core-title-editor.mjs";

const clientSource = readFileSync(new URL("../public/briefing-edit.js", import.meta.url), "utf8");
const endpointSource = readFileSync(new URL("../netlify/functions/worklog-edit.mts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("normalizeWorklogTitle trims and collapses whitespace",()=>{
  assert.equal(normalizeWorklogTitle("  범한매카텍   견적\n확인  "),"범한매카텍 견적 확인");
});

test("validWorklogPageId accepts Notion UUID forms",()=>{
  assert.equal(validWorklogPageId("12345678-1234-1234-1234-1234567890ab"),true);
  assert.equal(validWorklogPageId("123456781234123412341234567890ab"),true);
  assert.equal(validWorklogPageId("demo"),false);
});

test("Data Core title edit is scoped to record, workspace, and creator", async()=>{
  const calls=[];
  const id="12345678-1234-1234-1234-1234567890ab";
  const client={
    async update(table,row,query){
      calls.push({table,row,query});
      return [{id,title:row.title}];
    }
  };
  const editor=createWorklogDataCoreTitleEditor({client});
  const result=await editor.updateTitle(
    {recordId:id,title:"  이번주   금요일 와이프 픽업  "},
    {userId:"user-1",workspaceId:"workspace-1",role:"owner"}
  );

  assert.deepEqual(calls,[{
    table:"work_records",
    row:{title:"이번주 금요일 와이프 픽업"},
    query:{
      id:`eq.${id}`,
      workspace_id:"eq.workspace-1",
      creator_user_id:"eq.user-1"
    }
  }]);
  assert.deepEqual(result,{recordId:id,title:"이번주 금요일 와이프 픽업"});
});

test("Data Core title edit fails closed when ownership query returns no single row", async()=>{
  const editor=createWorklogDataCoreTitleEditor({client:{update:async()=>[]}});
  await assert.rejects(
    ()=>editor.updateTitle(
      {recordId:"12345678-1234-1234-1234-1234567890ab",title:"수정"},
      {userId:"user-1",workspaceId:"workspace-1",role:"owner"}
    ),
    error=>error?.code==="WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN"
  );
});

test("Platform briefing edit uses bearer auth without invoking the legacy owner prompt",()=>{
  assert.match(clientSource,/mode\(\)===\"data_core\"/);
  assert.match(clientSource,/WorklogPlatformAuth\?\.readSession\?\.\(\)/);
  assert.match(clientSource,/authorization:`Bearer \$\{session\.access_token\}`/);
  assert.match(clientSource,/WorklogAuth\.getHeaders\(\{promptOwner:true\}\)/);
  assert.match(clientSource,/data\.mode===\"data_core\" \? \"업무명을 수정했습니다\.\"/);
  assert.match(clientSource,/worklog:record-saved/);
});

test("worklog edit endpoint prefers authenticated Data Core and preserves legacy Notion fallback",()=>{
  const bearerIndex=endpointSource.indexOf("if(accessToken)");
  const legacyIndex=endpointSource.indexOf("const connection:any=resolveConnection(req)");
  assert.ok(bearerIndex>=0 && legacyIndex>bearerIndex,"Data Core bearer path must run before legacy Notion resolution");
  assert.match(endpointSource,/createWorklogDataCoreTitleEditor/);
  assert.match(endpointSource,/mode:\"data_core\"/);
  assert.match(endpointSource,/updateTitle\(token,pageId,nextTitle\)/);
});

test("main cache-busts the corrected briefing editor",()=>{
  assert.match(indexSource,/briefing-edit\.js\?v=20260916-1/);
});
