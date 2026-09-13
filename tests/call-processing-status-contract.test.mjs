import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../netlify/functions/call-processing-status.mts", import.meta.url));

test("통화 처리 상태 API는 direct upload를 기본 경계로 선언한다", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /directUploadRequired:\s*true/);
  assert.match(source, /functionAudioBodyUploadAllowed:\s*false/);
});

test("STT 공급자 선택은 비밀값이 아닌 명시적 환경변수 ID로만 읽는다", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /CALL_STT_PROVIDER/);
  assert.match(source, /CALL_STT_LIMITS_CONFIRMED/);
  assert.doesNotMatch(source, /API_KEY|SECRET|TOKEN/);
});

test("저장소·usage·실제 파이프라인은 연결 전까지 readiness에서 false다", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /tempStorageConfigured:\s*false/);
  assert.match(source, /usageLedgerConfigured:\s*false/);
  assert.match(source, /pipelineConfigured:\s*false/);
});
