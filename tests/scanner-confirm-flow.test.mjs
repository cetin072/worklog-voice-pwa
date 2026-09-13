import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const scanner=fs.readFileSync("public/scanner.js","utf8");
const index=fs.readFileSync("public/index.html","utf8");
const sw=fs.readFileSync("public/sw.js","utf8");

test("scanner geometry loads before scanner runtime and is cached",()=>{
  const geometryIndex=index.indexOf('/scanner-geometry.js');
  const scannerIndex=index.indexOf('/scanner.js');
  assert.ok(geometryIndex>=0 && scannerIndex>geometryIndex);
  assert.match(sw,/\/scanner-geometry\.js/);
});

test("scan confirmation stores the final scan before expensive OCR rendering",()=>{
  const handler=scanner.match(/scanApply\?\.addEventListener\("click",async\(\)=>\{([\s\S]*?)\}\);/);
  assert.ok(handler,"missing scan confirmation handler");
  assert.match(handler[1],/compressedScanBlob\(\)/);
  assert.doesNotMatch(handler[1],/highQualityOcrBlob\(/);
  assert.match(handler[1],/ocrState=\{corners:copyCorners\(corners\),filterMode\}/);
  assert.match(handler[1],/updatePreview\(\);closeDialog\(\)/);
});

test("OCR high quality image is generated lazily from the confirmed crop and selected filter",()=>{
  assert.match(scanner,/async function getOcrBlob\(\)/);
  assert.match(scanner,/highQualityOcrBlob\(pendingScan\.ocrState\)/);
  assert.match(scanner,/applyFilter\(canvas,mode\)/);
  assert.doesNotMatch(scanner,/filterMode==="bw"\?"bw":"document"/);
});

test("full-surface translation is removed in favor of anchored edge drag",()=>{
  assert.match(scanner,/type:"edge"/);
  assert.match(scanner,/geometry\.moveEdge/);
  assert.doesNotMatch(scanner,/type:"move"/);
  assert.doesNotMatch(scanner,/translatedCorners/);
});
