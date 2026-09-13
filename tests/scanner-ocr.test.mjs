import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index=fs.readFileSync("public/index.html","utf8");
const ocr=fs.readFileSync("public/scanner-ocr.js","utf8");
const build=fs.readFileSync("scripts/prepare-ocr-assets.mjs","utf8");
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));

test("scan preview exposes manual OCR review flow",()=>{
  for(const id of ["scanOcrRead","scanOcrStatus","scanOcrText","scanOcrUse","scanOcrClear"]){
    assert.match(index,new RegExp(`id=["']${id}["']`));
  }
  assert.match(index,/scanner-ocr\.js/);
});

test("OCR runtime is self-hosted and does not execute third-party CDN scripts",()=>{
  assert.match(ocr,/\/vendor\/tesseract\/tesseract\.min\.js/);
  assert.match(ocr,/\/vendor\/tesseract-core/);
  assert.match(ocr,/\/vendor\/tessdata/);
  assert.doesNotMatch(ocr,/https?:\/\//i);
  assert.doesNotMatch(ocr,/cdn\.jsdelivr|unpkg|projectnaptha/i);
});

test("OCR supports Korean and English and requires explicit user action",()=>{
  assert.match(ocr,/createWorker\(\["kor","eng"\]/);
  assert.match(ocr,/readButton\.addEventListener\("click",recognize\)/);
  assert.doesNotMatch(ocr,/previewImage\.addEventListener\("load",recognize/);
});

test("build copies pinned local OCR assets",()=>{
  assert.equal(pkg.dependencies["tesseract.js"],"7.0.0");
  assert.equal(pkg.dependencies["@tesseract.js-data/kor"],"1.0.0");
  assert.equal(pkg.dependencies["@tesseract.js-data/eng"],"1.0.0");
  assert.match(build,/tesseract-core-simd-lstm\.wasm\.js/);
  assert.match(build,/kor\.traineddata\.gz/);
  assert.match(build,/eng\.traineddata\.gz/);
});

test("OCR insertion preserves review and respects worklog text limit",()=>{
  assert.match(ocr,/combined\.length>1800/);
  assert.match(ocr,/업무 내용 저장 한도/);
  assert.match(ocr,/dispatchEvent\(new Event\("input"/);
});
