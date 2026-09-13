import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fnUrl = new URL("../netlify/functions/call-process.mts", import.meta.url);

async function source() {
  return readFile(fnUrl, "utf8");
}

test("통화 처리 API는 POST 외 요청을 거절한다", async () => {
  const text = await source();
  assert.match(text, /req\.method !== "POST"/);
  assert.match(text, /405/);
});

test("개발자 2인 유료 승인 전에는 서버에서 423으로 차단한다", async () => {
  const text = await source();
  assert.match(text, /if \(!gate\.enabled\)/);
  assert.match(text, /return json\(423/);
  assert.match(text, /paid_processing_locked/);
  assert.match(text, /requiredApprovals/);
});

test("승인 게이트가 열려도 실제 파이프라인 연결 전에는 501로 멈춘다", async () => {
  const text = await source();
  assert.match(text, /return json\(501/);
  assert.match(text, /pipeline_not_configured/);
});

test("현재 API 라우트에는 외부 STT 공급자 호출 구현이 직접 연결돼 있지 않다", async () => {
  const text = await source();
  assert.equal(text.includes("fetch("), false);
  assert.equal(text.includes("openai"), false);
  assert.equal(text.includes("clova"), false);
  assert.equal(text.includes("assemblyai"), false);
});
