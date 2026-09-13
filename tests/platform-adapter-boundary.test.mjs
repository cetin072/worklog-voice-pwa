import test from "node:test";
import assert from "node:assert/strict";

import {
  createConfiguredAdapter,
  createUnconfiguredAdapter,
  invokeAdapter,
  normalizeAdapterEnvelope,
  normalizeAdapterIdentity,
} from "../netlify/shared/platform/adapter-boundary.mjs";

test("configured adapter는 provider raw를 normalizer에만 전달하고 normalized envelope를 반환한다", async () => {
  const adapter = createConfiguredAdapter({
    service: "STT",
    provider: "OpenAI",
    operation: "Transcribe",
    run: async () => ({ vendorSecret: "do-not-leak", text: "안녕하세요", request_id: "vendor-1" }),
    normalize: async (raw) => ({
      result: { transcript: raw.text },
      providerRequestId: raw.request_id,
      model: "whisper-x",
      usage: { feature: "meeting_transcription", service: "stt", audioSeconds: 30 },
    }),
  });

  const output = await invokeAdapter(adapter, { objectPath: "tmp/a.m4a" });
  assert.equal(output.service, "stt");
  assert.equal(output.provider, "openai");
  assert.equal(output.operation, "transcribe");
  assert.equal(output.result.transcript, "안녕하세요");
  assert.equal(output.providerRequestId, "vendor-1");
  assert.equal("vendorSecret" in output, false);
  assert.equal("vendorSecret" in output.result, false);
});

test("adapter identity는 canonical token으로 정규화한다", () => {
  assert.deepEqual(normalizeAdapterIdentity({ service: " AI ", provider: "OpenAI", operation: "Summarize" }), {
    service: "ai",
    provider: "openai",
    operation: "summarize",
  });
});

test("잘못된 service/provider/operation을 차단한다", () => {
  assert.throws(() => normalizeAdapterIdentity({ service: "bad service", provider: "x" }), (e) => e?.code === "ADAPTER_SERVICE_INVALID");
  assert.throws(() => normalizeAdapterIdentity({ service: "ai", provider: "bad provider" }), (e) => e?.code === "ADAPTER_PROVIDER_INVALID");
  assert.throws(() => normalizeAdapterIdentity({ service: "ai", provider: "x", operation: "bad op" }), (e) => e?.code === "ADAPTER_OPERATION_INVALID");
});

test("configured adapter에는 run과 normalize가 모두 필요하다", () => {
  assert.throws(
    () => createConfiguredAdapter({ service: "ai", provider: "x", normalize: (x) => x }),
    (e) => e?.code === "ADAPTER_RUN_REQUIRED",
  );
  assert.throws(
    () => createConfiguredAdapter({ service: "ai", provider: "x", run: async () => ({}) }),
    (e) => e?.code === "ADAPTER_NORMALIZE_REQUIRED",
  );
});

test("생성 후 원본 config를 변경해도 adapter 동작이 바뀌지 않는다", async () => {
  const config = {
    service: "ai",
    provider: "x",
    run: async () => ({ answer: "first" }),
    normalize: async (raw) => ({ result: { answer: raw.answer } }),
  };
  const adapter = createConfiguredAdapter(config);
  config.run = async () => ({ answer: "mutated" });
  config.normalize = async () => ({ result: { answer: "mutated-normalizer" } });
  const output = await invokeAdapter(adapter);
  assert.equal(output.result.answer, "first");
});

test("normalizer가 domain-safe result 객체를 만들지 않으면 차단한다", async () => {
  const adapter = createConfiguredAdapter({
    service: "ai",
    provider: "x",
    run: async () => ({ answer: "ok" }),
    normalize: async () => ({ result: "raw-string" }),
  });
  await assert.rejects(() => invokeAdapter(adapter), (e) => e?.code === "ADAPTER_RESULT_REQUIRED");
});

test("envelope identity는 normalized payload가 덮어쓸 수 없다", () => {
  const envelope = normalizeAdapterEnvelope({
    service: "evil",
    provider: "evil",
    result: { ok: true },
  }, { service: "calendar", provider: "google" });
  assert.equal(envelope.service, "calendar");
  assert.equal(envelope.provider, "google");
});

test("providerRequestId/model 길이 초과를 조용히 자르지 않는다", () => {
  assert.throws(
    () => normalizeAdapterEnvelope({ result: {}, providerRequestId: "x".repeat(201) }, { service: "ai", provider: "x" }),
    (e) => e?.code === "ADAPTER_PROVIDER_REQUEST_ID_INVALID",
  );
  assert.throws(
    () => normalizeAdapterEnvelope({ result: {}, model: "m".repeat(121) }, { service: "ai", provider: "x" }),
    (e) => e?.code === "ADAPTER_MODEL_INVALID",
  );
});

test("usage와 metadata는 객체 계약을 지키고 provider raw와 분리된 복사본으로 반환한다", async () => {
  const usage = { inputTokens: 10 };
  const metadata = { region: "kr" };
  const adapter = createConfiguredAdapter({
    service: "ai",
    provider: "x",
    run: async () => ({ value: 1 }),
    normalize: async () => ({ result: { value: 1 }, usage, metadata }),
  });
  const output = await invokeAdapter(adapter);
  usage.inputTokens = 99;
  metadata.region = "us";
  assert.equal(output.usage.inputTokens, 10);
  assert.equal(output.metadata.region, "kr");
  assert.equal(Object.isFrozen(output.result), true);

  assert.throws(
    () => normalizeAdapterEnvelope({ result: {}, usage: [1] }, { service: "ai", provider: "x" }),
    (e) => e?.code === "ADAPTER_USAGE_INVALID",
  );
  assert.throws(
    () => normalizeAdapterEnvelope({ result: {}, metadata: "bad" }, { service: "ai", provider: "x" }),
    (e) => e?.code === "ADAPTER_METADATA_INVALID",
  );
});

test("unconfigured adapter와 임의 객체 adapter 호출은 fail-closed", async () => {
  const unconfigured = createUnconfiguredAdapter({ service: "crm", provider: "example" });
  assert.equal(unconfigured.configured, false);
  await assert.rejects(() => unconfigured.invoke(), (e) => e?.code === "ADAPTER_NOT_CONFIGURED");
  await assert.rejects(() => invokeAdapter(unconfigured), (e) => e?.code === "ADAPTER_NOT_CONFIGURED");
  await assert.rejects(() => invokeAdapter({ configured: true, invoke: async () => ({ raw: true }) }), (e) => e?.code === "ADAPTER_INVALID");
});

test("provider와 normalizer의 실제 오류는 성공으로 숨기지 않는다", async () => {
  const providerFail = createConfiguredAdapter({
    service: "ai",
    provider: "x",
    run: async () => { throw Object.assign(new Error("provider down"), { code: "PROVIDER_DOWN" }); },
    normalize: async () => ({ result: {} }),
  });
  await assert.rejects(() => invokeAdapter(providerFail), (e) => e?.code === "PROVIDER_DOWN");

  const normalizeFail = createConfiguredAdapter({
    service: "ai",
    provider: "x",
    run: async () => ({ bad: true }),
    normalize: async () => { throw Object.assign(new Error("bad payload"), { code: "NORMALIZE_FAIL" }); },
  });
  await assert.rejects(() => invokeAdapter(normalizeFail), (e) => e?.code === "NORMALIZE_FAIL");
});
