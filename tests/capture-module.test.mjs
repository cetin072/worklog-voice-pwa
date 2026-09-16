import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("capture module starts from gallery without forcing camera",()=>{const html=read("public/capture.html");const tag=html.match(/<input id="captureInput"[^>]*>/)?.[0]||"";assert.match(tag,/accept="image\/\*"/);assert.doesNotMatch(tag,/capture=/);assert.match(html,/원본 이미지는 이 기기에서만 읽습니다/);});
test("capture image stays local and only extracted text is analyzed",()=>{const source=read("public/capture.js");assert.match(source,/\/api\/capture-analyze/);assert.match(source,/JSON\.stringify\(\{text:value/);assert.doesNotMatch(source,/FormData/);assert.doesNotMatch(source,/selectedFile[^\n]{0,120}body/);});
test("capture confirmation reuses canonical worklog save",()=>{const source=read("public/capture.js");assert.match(source,/\/api\/worklog/);assert.match(source,/button\.addEventListener\("click",\(\)=>saveCandidate/);assert.doesNotMatch(source,/save_my_worklog_with_schedule/);});
test("capture OCR uses self-hosted runtime prepared at build",()=>{const source=read("public/capture.js"),pkg=JSON.parse(read("package.json")),netlify=read("netlify.toml");assert.match(source,/\/vendor\/tesseract\/tesseract\.min\.js/);assert.equal(pkg.dependencies["tesseract.js"],"7.0.0");assert.equal(pkg.scripts.build,"npm run prepare:ocr && npm test");assert.match(netlify,/command = "npm run build"/);});
