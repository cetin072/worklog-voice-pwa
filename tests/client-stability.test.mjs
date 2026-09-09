import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function localStorageMock(){
  const values=new Map();
  return {
    getItem:key=>values.has(key) ? values.get(key) : null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key)
  };
}

function element(value=""){
  return {
    value,
    textContent:"",
    className:"",
    disabled:false,
    dataset:{},
    onclick:async()=>{},
    classList:{contains:()=>false,add(){},remove(){},toggle(){}},
    addEventListener(){},
    dispatchEvent(){}
  };
}

function loadQuickSave(touched=new Set()){
  const ids=["mic","save","clear","result","hint","text","institution","status","type","amount","assignee","dueDate","followUp"];
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  elements.institution.value="기타";
  elements.status.value="진행중";
  elements.type.value="기타";

  const window={
    mergeWithOverlap:(left,right)=>[left,right].filter(Boolean).join(" ").trim(),
    WorklogInferenceGuard:{isTouched:id=>touched.has(id)},
    getAccessKey:()=>"test-key"
  };
  const context={
    window,
    document:{getElementById:id=>elements[id] || null},
    console,
    Event:class Event{},
    navigator:{vibrate(){}},
    localStorage:localStorageMock(),
    setTimeout,
    clearTimeout
  };
  window.window=window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/quick-save.js","utf8"),context);
  return {api:window.__worklogSplitTest,elements};
}

test("splitWorkItems separates explicit next-work markers",()=>{
  const {api}=loadQuickSave();
  assert.deepEqual(
    Array.from(api.splitWorkItems("세금계산서 발행 다음 업무 차량등록소 전화")),
    ["세금계산서 발행","차량등록소 전화"]
  );
});

test("splitWorkItems accepts next-item particle and bare geudaeum",()=>{
  const {api}=loadQuickSave();
  assert.deepEqual(
    Array.from(api.splitWorkItems("회의 끝났고 다음 건은 세금계산서")),
    ["회의 끝났고","세금계산서"]
  );
  assert.deepEqual(
    Array.from(api.splitWorkItems("첫 업무 그다음 차량등록소 전화")),
    ["첫 업무","차량등록소 전화"]
  );
});

test("splitWorkItems does not split ordinary phrase about other work",()=>{
  const {api}=loadQuickSave();
  assert.deepEqual(
    Array.from(api.splitWorkItems("오늘 다른 업무 없음 확인했음")),
    ["오늘 다른 업무 없음 확인했음"]
  );
});

test("manual status and type survive split inference",()=>{
  const {api}=loadQuickSave(new Set(["status","type"]));
  const inferred=api.inferFields("내일 세금계산서 발행해야 함",{
    institution:"기타",
    status:"확인필요",
    type:"아이디어"
  });
  assert.equal(inferred.status,"확인필요");
  assert.equal(inferred.type,"아이디어");
});

test("worklog request id is reused after an ambiguous network failure",async()=>{
  const storage=localStorageMock();
  const sent=[];
  let fail=true;
  const nativeFetch=async(_input,init)=>{
    sent.push(JSON.parse(init.body));
    if(fail){
      fail=false;
      throw new Error("network lost after request");
    }
    return {ok:true};
  };
  const window={fetch:nativeFetch};
  const context={
    window,
    localStorage:storage,
    crypto:{randomUUID:()=>`id-${String(sent.length+1).padStart(14,"0")}`},
    Request:class Request{},
    console,
    Date,
    JSON,
    Math
  };
  window.window=window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/request-id.js","utf8"),context);

  const init={method:"POST",body:JSON.stringify({transcript:"같은 업무",status:"진행중"})};
  await assert.rejects(()=>window.fetch("/api/worklog",init));
  await window.fetch("/api/worklog",init);
  assert.equal(sent[0].clientRequestId,sent[1].clientRequestId);

  await window.fetch("/api/worklog",init);
  assert.notEqual(sent[1].clientRequestId,sent[2].clientRequestId);
});
