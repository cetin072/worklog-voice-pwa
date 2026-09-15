import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {spawnSync} from "node:child_process";

const index=fs.readFileSync("public/index.html","utf8");
const scanner=fs.readFileSync("public/scanner.js","utf8");
const sw=fs.readFileSync("public/sw.js","utf8");

test("scanner entry points are static and gallery is independent from camera capture",()=>{
  assert.match(index,/id="scannerCard"/);
  assert.match(index,/id="scanGallery"[^>]*>🖼 갤러리에서 문서 선택/);
  assert.match(index,/id="scanCamera"[^>]*>📷 카메라로 촬영/);
  assert.match(index,/id="scanGalleryInput"[^>]*multiple/);
  const galleryTag=index.match(/<input id="scanGalleryInput"[^>]*>/)?.[0]||"";
  const cameraTag=index.match(/<input id="scanCameraInput"[^>]*>/)?.[0]||"";
  assert.doesNotMatch(galleryTag,/capture=/);
  assert.match(cameraTag,/capture="environment"/);
});

test("scanner core flow stays local-first and separate from Notion worklog writes",()=>{
  assert.match(scanner,/DB_NAME="worklog-scanner-v3"/);
  assert.match(scanner,/type:"ScanDocument"/);
  assert.match(scanner,/localOnly:true/);
  assert.match(scanner,/persistPages/);
  assert.match(scanner,/import\("\/scanner-pdf\.js"\)/);
  assert.doesNotMatch(scanner,/\/api\/worklog/);
  assert.doesNotMatch(scanner,/Notion/i);
  assert.doesNotMatch(scanner,/window\.fetch\s*=/);
});

test("scanner supports page edit delete reorder PDF save and share",()=>{
  for(const token of ["movePage","deletePage","editPage","buildPdf","downloadPdf","navigator.share","navigator.canShare"])assert.match(scanner,new RegExp(token.replace(".","\\.")));
  assert.match(index,/id="scanPdfSave"/);
  assert.match(index,/id="scanPdfShare"/);
});

test("scanner runtime assets are available offline and source files parse",()=>{
  for(const asset of ["/scanner.css","/scanner-core.js","/scanner-geometry.js","/scanner.js","/scanner-pdf.js"])assert.ok(sw.includes(`"${asset}"`),`${asset} must be precached`);
  for(const file of ["public/scanner-core.js","public/scanner-geometry.js","public/scanner.js","public/scanner-pdf.js"]){
    const result=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr||`${file} syntax check failed`);
  }
});
