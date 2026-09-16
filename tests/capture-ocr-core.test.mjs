import test from "node:test";
import assert from "node:assert/strict";
import {normalizeOcr,shouldRetry,chooseBetter,otsuThreshold} from "../public/capture-ocr-core.mjs";

test("capture OCR normalizes whitespace without destroying lines",()=>{assert.equal(normalizeOcr("  내일   2시 \n\n 삼현 미팅  "),"내일 2시\n\n삼현 미팅");});
test("capture OCR retries low-confidence or too-short text",()=>{assert.equal(shouldRetry({text:"미팅",confidence:91}),true);assert.equal(shouldRetry({text:"내일 오후 두 시에 삼현에서 미팅합니다",confidence:80}),false);});
test("capture OCR selects materially better retry",()=>{const selected=chooseBetter({text:"내일 미팅",confidence:54,source:"first"},{text:"내일 오후 2시 삼현 미팅",confidence:73,source:"retry"});assert.equal(selected.source,"retry");});
test("capture OCR Otsu threshold stays in byte range",()=>{const hist=new Uint32Array(256);hist[20]=100;hist[230]=100;const threshold=otsuThreshold(hist,200);assert.ok(threshold>=0&&threshold<=255);});
