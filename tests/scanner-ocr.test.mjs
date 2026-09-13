import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index=fs.readFileSync("public/index.html","utf8");
const ocr=fs.readFileSync("public/scanner-ocr.js","utf8");
const sw=fs.readFileSync("public/sw.js","utf8");
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

test("failed OCR script loads are removable so retry performs a real reload",()=>{
  assert.match(ocr,/existing\.remove\(\)/);
  assert.match(ocr,/script\.remove\(\)/);
  assert.match(ocr,/scriptPromise=null/);
});

test("service worker caches self-hosted OCR assets after the first successful load",()=>{
  assert.match(sw,/pathname\.startsWith\("\/vendor\/"\)/);
  assert.match(sw,/cache\.match\(e\.request\)/);
  assert.match(sw,/cache\.put\(e\.request,response\.clone\(\)\)/);
});

test("build copies complete local OCR runtime",()=>{
  assert.equal(pkg.dependencies["tesseract.js"],"7.0.0");
  assert.equal(pkg.dependencies["@tesseract.js-data/kor"],"1.0.0");
  assert.equal(pkg.dependencies["@tesseract.js-data/eng"],"1.0.0");
  assert.match(build,/\.wasm\(\?:\\\.js\)\?/);
  assert.match(build,/readdir\(coreSource\)/);
  assert.match(build,/kor\.traineddata\.gz/);
  assert.match(build,/eng\.traineddata\.gz/);

  const coreDir="public/vendor/tesseract-core";
  const coreFiles=fs.readdirSync(coreDir);
  assert.ok(coreFiles.some(file=>file.endsWith(".wasm.js")),"missing Tesseract wasm loader");
  assert.ok(coreFiles.some(file=>file.endsWith(".wasm")),"missing Tesseract wasm binary");
  assert.ok(fs.existsSync("public/vendor/tesseract/tesseract.min.js"));
  assert.ok(fs.existsSync("public/vendor/tesseract/worker.min.js"));
  assert.ok(fs.existsSync("public/vendor/tessdata/kor.traineddata.gz"));
  assert.ok(fs.existsSync("public/vendor/tessdata/eng.traineddata.gz"));
});

test("OCR insertion preserves review and respects worklog text limit",()=>{
  assert.match(ocr,/combined\.length>1800/);
  assert.match(ocr,/업무 내용 저장 한도/);
  assert.match(ocr,/dispatchEvent\(new Event\("input"/);
});
