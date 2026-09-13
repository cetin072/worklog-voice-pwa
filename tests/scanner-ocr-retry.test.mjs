import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadOcrCore(){
  const context={
    window:{},
    document:{getElementById:()=>null},
    Uint32Array,
    Math,
    Number,
    String
  };
  context.window.window=context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/scanner-ocr.js","utf8"),context);
  return context.window.WorklogOcrCore;
}

test("low-confidence OCR triggers one local retry",()=>{
  const core=loadOcrCore();
  assert.equal(core.RETRY_CONFIDENCE,60);
  assert.equal(core.shouldRetry({text:"DC 5V 3A 테스트",confidence:40}),true);
  assert.equal(core.shouldRetry({text:"정상적으로 충분히 읽힌 문서 내용 12345",confidence:82}),false);
});

test("retry result wins when confidence or Korean recovery improves",()=>{
  const core=loadOcrCore();
  const confidenceWinner=core.chooseBetter(
    {text:"OCR TEST",confidence:40,source:"first"},
    {text:"OCR TEST 123",confidence:58,source:"retry"}
  );
  assert.equal(confidenceWinner.source,"retry");

  const koreanWinner=core.chooseBetter(
    {text:"HAR OCA Vdc 2A",confidence:55,source:"first"},
    {text:"기준출력품 HAR OCA Vdc 2A",confidence:52,source:"retry"}
  );
  assert.equal(koreanWinner.source,"retry");
});

test("OCR retry path uses bounded local preprocessing and single-block retry",()=>{
  const source=fs.readFileSync("public/scanner-ocr.js","utf8");
  assert.match(source,/ENHANCE_MAX_EDGE=2000/);
  assert.match(source,/ENHANCE_MAX_PIXELS=3200000/);
  assert.match(source,/ENHANCE_MAX_SCALE=2\.2/);
  assert.match(source,/grayscale\(1\) contrast\(1\.6\) brightness\(1\.05\)/);
  assert.match(source,/otsuThreshold\(histogram,pixelCount\)/);
  assert.match(source,/if\(shouldRetry\(first\)\)/);
  assert.match(source,/tessedit_pageseg_mode:"6"/);
  assert.match(source,/const retryResponse=await worker\.recognize\(enhancedBlob\)/);
  assert.match(source,/if\(!first\.text\)throw retryError;\s*selected=first/);
});
