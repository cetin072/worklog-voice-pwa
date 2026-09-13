import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadCore(){
  const context={window:{},Float32Array,Math,Number};
  context.window.window=context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/scanner-core.js","utf8"),context);
  return context.window.WorklogScannerCore;
}

test("scanner core maps an untouched rectangle with identity homography",()=>{
  const core=loadCore();
  const h=core.homographyFromUnitSquare({
    topLeftCorner:{x:0,y:0},
    topRightCorner:{x:100,y:0},
    bottomRightCorner:{x:100,y:200},
    bottomLeftCorner:{x:0,y:200}
  },100,200);
  assert.ok(Math.abs(h[0]-1)<1e-8);
  assert.ok(Math.abs(h[4]-1)<1e-8);
  assert.ok(h.slice(1,4).every((value,index)=>index===2?Math.abs(value)<1e-8:Math.abs(value)<1e-8));
  assert.ok(Math.abs(h[6])<1e-8 && Math.abs(h[7])<1e-8);
});

test("scanner core detects a high-contrast document rectangle",()=>{
  const core=loadCore();
  const width=100,height=120,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const offset=(y*width+x)*4;
      const value=x>=15&&x<=85&&y>=20&&y<=100?245:20;
      data[offset]=value;data[offset+1]=value;data[offset+2]=value;data[offset+3]=255;
    }
  }
  const corners=core.detectDocumentCorners({data},width,height);
  assert.ok(corners);
  assert.ok(Math.abs(corners.topLeftCorner.x-15)<4);
  assert.ok(Math.abs(corners.topLeftCorner.y-20)<4);
  assert.ok(Math.abs(corners.bottomRightCorner.x-85)<4);
  assert.ok(Math.abs(corners.bottomRightCorner.y-100)<4);
});

test("scanner runtime has no external OpenCV, jscanify, or deprecated scanner shims",()=>{
  const scanner=fs.readFileSync("public/scanner.js","utf8");
  const index=fs.readFileSync("public/index.html","utf8");
  const sw=fs.readFileSync("public/sw.js","utf8");
  assert.doesNotMatch(scanner,/opencv\.org|jsdelivr|jscanify|OPEN_CV_URL|JSCANIFY_URL/i);
  assert.match(index,/scanner-core\.js/);
  assert.doesNotMatch(index,/scanner-mobile-guard\.js|scanner-save-bridge\.js/);
  assert.doesNotMatch(sw,/scanner-mobile-guard\.js|scanner-save-bridge\.js/);
  assert.equal(fs.existsSync("public/scanner-mobile-guard.js"),false);
  assert.equal(fs.existsSync("public/scanner-save-bridge.js"),false);
});

test("scan button opens the native image capture immediately",()=>{
  const scanner=fs.readFileSync("public/scanner.js","utf8");
  assert.match(scanner,/scanButton\.addEventListener\("click",\(\)=>scanInput\.click\(\)\)/);
});

test("scanned save keeps schedule extraction",()=>{
  const scanFn=fs.readFileSync("netlify/functions/worklog-scan.mts","utf8");
  assert.match(scanFn,/extractScheduleFromText/);
  assert.match(scanFn,/cleanTranscript/);
  assert.match(scanFn,/schedule\.dueStart/);
});
