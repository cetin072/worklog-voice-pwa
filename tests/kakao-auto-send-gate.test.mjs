import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../netlify/shared/kakao.mts", import.meta.url), "utf8");

test("Kakao scheduled briefing has an operations pause gate", () => {
  assert.match(source, /KAKAO_AUTO_SEND_ENABLED/);
  assert.match(source, /options\.automatic && !automaticKakaoSendEnabled\(\)/);
  assert.match(source, /reason:"auto-paused"/);
});

test("Kakao pause gate only applies to automatic sends", () => {
  const gate = source.indexOf("options.automatic && !automaticKakaoSendEnabled()");
  const manual = source.indexOf("if(options.manual)");
  assert.ok(gate > -1);
  assert.ok(manual > -1);
});
