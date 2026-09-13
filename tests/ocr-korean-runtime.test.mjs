import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {createWorker} from "tesseract.js";

test("Korean and English OCR models initialize together",{timeout:90000},async()=>{
  const langPath=path.resolve("public/vendor/tessdata");
  assert.ok(fs.existsSync(path.join(langPath,"kor.traineddata.gz")),"missing Korean traineddata");
  assert.ok(fs.existsSync(path.join(langPath,"eng.traineddata.gz")),"missing English traineddata");
  const worker=await createWorker(["kor","eng"],1,{
    langPath,
    cacheMethod:"none",
    gzip:true,
    logger:()=>{}
  });
  try{
    assert.ok(worker,"Korean+English OCR worker did not initialize");
  }finally{
    await worker.terminate();
  }
});
