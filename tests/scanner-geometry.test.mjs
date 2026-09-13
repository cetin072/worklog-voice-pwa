import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadGeometry(){
  const context={window:{},Math,Object};
  context.window.window=context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/scanner-geometry.js","utf8"),context);
  return context.window.WorklogScannerGeometry;
}

const rect={
  topLeftCorner:{x:20,y:20},
  topRightCorner:{x:180,y:20},
  bottomRightCorner:{x:180,y:280},
  bottomLeftCorner:{x:20,y:280}
};

function assertPoint(point,x,y){
  assert.equal(Math.round(point.x),x);
  assert.equal(Math.round(point.y),y);
}

test("dragging a side moves only that side and keeps the opposite side anchored",()=>{
  const geometry=loadGeometry();
  const moved=geometry.moveEdge(rect,"top",0,40,200,300);
  assertPoint(moved.topLeftCorner,20,60);
  assertPoint(moved.topRightCorner,180,60);
  assertPoint(moved.bottomLeftCorner,20,280);
  assertPoint(moved.bottomRightCorner,180,280);
});

test("side drag follows the edge normal instead of sliding the whole quad",()=>{
  const geometry=loadGeometry();
  const moved=geometry.moveEdge(rect,"left",50,80,200,300);
  assertPoint(moved.topLeftCorner,70,20);
  assertPoint(moved.bottomLeftCorner,70,280);
  assertPoint(moved.topRightCorner,180,20);
  assertPoint(moved.bottomRightCorner,180,280);
});

test("nearest edge can be selected near the middle of a side",()=>{
  const geometry=loadGeometry();
  assert.equal(geometry.nearestEdge(rect,{x:100,y:24},12),"top");
  assert.equal(geometry.nearestEdge(rect,{x:100,y:150},12),null);
});
