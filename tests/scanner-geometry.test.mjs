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

test("dragging a side moves only that side and keeps the opposite side anchored",()=>{
  const geometry=loadGeometry();
  const moved=geometry.moveEdge(rect,"top",0,40,200,300);
  assert.equal(Math.round(moved.topLeftCorner.y),60);
  assert.equal(Math.round(moved.topRightCorner.y),60);
  assert.deepEqual(moved.bottomLeftCorner,rect.bottomLeftCorner);
  assert.deepEqual(moved.bottomRightCorner,rect.bottomRightCorner);
});

test("side drag follows the edge normal instead of sliding the whole quad",()=>{
  const geometry=loadGeometry();
  const moved=geometry.moveEdge(rect,"left",50,80,200,300);
  assert.equal(Math.round(moved.topLeftCorner.x),70);
  assert.equal(Math.round(moved.bottomLeftCorner.x),70);
  assert.equal(moved.topLeftCorner.y,20);
  assert.equal(moved.bottomLeftCorner.y,280);
  assert.deepEqual(moved.topRightCorner,rect.topRightCorner);
  assert.deepEqual(moved.bottomRightCorner,rect.bottomRightCorner);
});

test("nearest edge can be selected near the middle of a side",()=>{
  const geometry=loadGeometry();
  assert.equal(geometry.nearestEdge(rect,{x:100,y:24},12),"top");
  assert.equal(geometry.nearestEdge(rect,{x:100,y:150},12),null);
});
