import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const indexHtml=fs.readFileSync("public/index.html","utf8");
const sw=fs.readFileSync("public/sw.js","utf8");
const loader=fs.readFileSync("public/briefing-edit-loader.js","utf8");

function runLoader(metaText,{preview=false}={}){
  const appended=[];
  const root={hidden:false};
  const meta={textContent:metaText};
  const document={
    head:{appendChild(node){appended.push(node);}},
    getElementById(id){
      if(id==="briefingV2") return root;
      if(id==="briefingMeta") return meta;
      return null;
    },
    querySelector(selector){
      if(selector.includes("briefing-edit-style")) return appended.find(node=>node.dataset?.briefingEditStyle);
      if(selector.includes("briefing-edit-script")) return appended.find(node=>node.dataset?.briefingEditScript);
      return null;
    },
    createElement(tag){return {tagName:tag.toUpperCase(),dataset:{}};},
  };
  class MutationObserverMock{observe(){}}
  const context={
    document,
    MutationObserver:MutationObserverMock,
    URLSearchParams,
    location:{hostname:preview?"deploy-preview-243--worklog-voice-pwa.netlify.app":"worklog-voice-pwa.netlify.app",search:preview?"?briefingDemo=1":""},
  };
  vm.createContext(context);
  vm.runInContext(loader,context);
  return appended;
}

test("main shell no longer eagerly loads legacy briefing edit assets",()=>{
  assert.doesNotMatch(indexHtml,/<link[^>]+href="\/briefing-edit\.css"/);
  assert.doesNotMatch(indexHtml,/<script[^>]+src="\/briefing-edit\.js"/);
  assert.match(indexHtml,/\/briefing-edit-loader\.js\?v=/);
});

test("Data Core briefing skips edit CSS and JS",()=>{
  const appended=runLoader("9. 16. 오후 2:30 · 미완료 4건 · Data Core 기준");
  assert.equal(appended.length,0);
});

test("Notion briefing lazy-loads edit CSS and JS",()=>{
  const appended=runLoader("9. 16. 오후 2:30 · 미완료 4건 · Notion 최신 기준");
  assert.equal(appended.length,2);
  assert.equal(appended[0].href,"/briefing-edit.css");
  assert.equal(appended[1].src,"/briefing-edit.js");
});

test("Preview demo keeps edit assets available",()=>{
  const appended=runLoader("예시 업무로 보는 브리핑 2.0 화면",{preview:true});
  assert.equal(appended.length,2);
});

test("service worker precaches loader but not optional edit assets",()=>{
  const files=sw.match(/const FILES=\[(.*?)\];/s)?.[1] || "";
  assert.match(files,/briefing-edit-loader\.js/);
  assert.doesNotMatch(files,/briefing-edit\.css/);
  assert.doesNotMatch(files,/briefing-edit\.js/);
});
