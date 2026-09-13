import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {createWorker} from "tesseract.js";

const ONE_PIXEL_PNG=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const diagnosticPath=path.resolve("public/ocr-smoke-diagnostic.json");

test("diagnose actual local OCR recognize call",{timeout:90000},async()=>{
  const langPath=path.resolve("public/vendor/tessdata");
  const diagnostic={
    engModel:fs.existsSync(path.join(langPath,"eng.traineddata.gz")),
    korModel:fs.existsSync(path.join(langPath,"kor.traineddata.gz")),
    initialized:false,
    recognizeReturned:false,
    text:"",
    error:""
  };
  let worker;
  try{
    worker=await createWorker("eng",1,{langPath,cacheMethod:"none",gzip:true,logger:()=>{}});
    diagnostic.initialized=true;
    const {data}=await worker.recognize(ONE_PIXEL_PNG);
    diagnostic.recognizeReturned=true;
    diagnostic.text=String(data?.text||"").slice(0,200);
  }catch(error){
    diagnostic.error=String(error?.stack||error?.message||error||"").slice(0,2000);
  }finally{
    try{await worker?.terminate?.();}catch{}
    fs.writeFileSync(diagnosticPath,JSON.stringify(diagnostic,null,2));
  }
  assert.equal(diagnostic.initialized,true,"OCR worker must initialize");
});
