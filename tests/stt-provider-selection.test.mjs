import test from "node:test";
import assert from "node:assert/strict";
import { resolveSttProviderSelection } from "../netlify/shared/stt-provider-selection.mjs";
import { defaultProviderRegistry } from "../netlify/shared/provider-adapter-contract.mjs";

test("공급자를 고르지 않으면 선택 준비가 잠긴다", () => {
  const result = resolveSttProviderSelection({ registry: defaultProviderRegistry() });
  assert.equal(result.selected, false);
  assert.equal(result.reason, "provider_not_selected");
  assert.equal(result.ready, false);
});

test("지원하지 않는 공급자 ID는 차단한다", () => {
  const result = resolveSttProviderSelection({ providerId: "unknown", registry: defaultProviderRegistry() });
  assert.equal(result.supported, false);
  assert.equal(result.providerId, "");
  assert.equal(result.reason, "provider_not_supported");
});

test("공급자를 선택해도 한도 확인 전에는 준비완료가 아니다", () => {
  const result = resolveSttProviderSelection({ providerId: "clova", registry: defaultProviderRegistry() });
  assert.equal(result.selected, true);
  assert.equal(result.limitsConfirmed, false);
  assert.equal(result.reason, "provider_limits_unconfirmed");
});

test("선택·한도·어댑터가 모두 준비된 경우에만 공급자 준비완료다", () => {
  const registry = { stt: { clova: { provider: "clova", configured: true } } };
  const result = resolveSttProviderSelection({ providerId: "clova", limitsConfirmed: true, registry });
  assert.equal(result.selected, true);
  assert.equal(result.adapterConfigured, true);
  assert.equal(result.ready, true);
  assert.equal(result.reason, "ready");
});
