import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {createWorker} from "tesseract.js";

test("local English OCR runtime initializes from self-hosted traineddata",{timeout:90000},async()=>{
  const langPath=path.resolve("public/vendor/tessdata");
  assert.ok(fs.existsSync(path.join(langPath,"eng.traineddata.gz")),"missing English traineddata");
  const worker=await createWorker("eng",1,{
    langPath,
    cacheMethod:"none",
    gzip:true,
    logger:()=>{}
  });
  try{
    assert.ok(worker,"OCR worker did not initialize");
  }finally{
    await worker.terminate();
  }
});
