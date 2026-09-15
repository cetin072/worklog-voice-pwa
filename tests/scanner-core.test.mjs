import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadCore(){
  const context={window:{},Float32Array,Uint32Array,Math,Number};
  context.window.window=context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/scanner-core.js","utf8"),context);
  return context.window.WorklogScannerCore;
}

function insidePolygon(x,y,points){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/((b.y-a.y)||1e-9)+a.x))inside=!inside;
  }
  return inside;
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
  assert.ok(h.slice(1,4).every(value=>Math.abs(value)<1e-8));
  assert.ok(Math.abs(h[6])<1e-8 && Math.abs(h[7])<1e-8);
});

test("scanner core detects a high-contrast document rectangle",()=>{
  const core=loadCore();
  const width=100,height=120,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*4,value=x>=15&&x<=85&&y>=20&&y<=100?245:20;
    data[offset]=value;data[offset+1]=value;data[offset+2]=value;data[offset+3]=255;
  }
  const corners=core.detectDocumentCorners({data},width,height);
  assert.ok(corners);
  assert.ok(Math.abs(corners.topLeftCorner.x-15)<5);
  assert.ok(Math.abs(corners.topLeftCorner.y-20)<5);
  assert.ok(Math.abs(corners.bottomRightCorner.x-85)<5);
  assert.ok(Math.abs(corners.bottomRightCorner.y-100)<5);
});

test("scanner core detects a rotated perspective document",()=>{
  const core=loadCore();
  const width=150,height=140,data=new Uint8ClampedArray(width*height*4);
  const expected=[{x:27,y:18},{x:124,y:35},{x:108,y:119},{x:17,y:97}];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*4,value=insidePolygon(x+.5,y+.5,expected)?242:24;
    data[offset]=value;data[offset+1]=value;data[offset+2]=value;data[offset+3]=255;
  }
  const corners=core.detectDocumentCorners({data},width,height);
  assert.ok(corners,"rotated document should be detected");
  const actual=[corners.topLeftCorner,corners.topRightCorner,corners.bottomRightCorner,corners.bottomLeftCorner];
  for(let i=0;i<4;i++)assert.ok(Math.hypot(actual[i].x-expected[i].x,actual[i].y-expected[i].y)<14,`corner ${i} too far from rotated document`);
});
