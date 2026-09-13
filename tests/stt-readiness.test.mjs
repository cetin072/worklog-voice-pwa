import test from "node:test";
import assert from "node:assert/strict";
import { CALL_ANALYSIS_CONTRACT_VERSION } from "../netlify/shared/call-analysis-contract.mjs";
import { defaultProviderRegistry } from "../netlify/shared/provider-adapter-contract.mjs";
import { buildCurrentSttReadiness, evaluateSttReadiness } from "../netlify/shared/stt-readiness.mjs";

test("모든 연결조건이 충족되기 전에는 live STT 준비완료가 아니다", () => {
  const result = evaluateSttReadiness({ reportContractReady: true });
  assert.equal(result.readyForLiveStt, false);
  assert.equal(result.readyCount, 1);
  assert.equal(result.totalCount, 8);
  assert.equal(result.blockers.includes("provider_selected"), true);
  assert.equal(result.blockers.includes("paid_approval"), true);
});

test("모든 준비조건이 true일 때만 live STT 준비완료다", () => {
  const result = evaluateSttReadiness({
    reportContractReady: true,
    providerSelected: true,
    providerLimitsConfirmed: true,
    providerAdapterConfigured: true,
    tempStorageConfigured: true,
    usageLedgerConfigured: true,
    paidApprovalReady: true,
    pipelineConfigured: true,
  });
  assert.equal(result.readyForLiveStt, true);
  assert.equal(result.readyCount, result.totalCount);
  assert.deepEqual(result.blockers, []);
});

test("현재 기본 레지스트리는 보고서 계약만 준비되고 공급자 연결은 잠겨 있다", () => {
  const result = buildCurrentSttReadiness({
    paidGate: { enabled: false },
    contractVersion: CALL_ANALYSIS_CONTRACT_VERSION,
    registry: defaultProviderRegistry(),
  });
  assert.equal(result.checks.find((item) => item.id === "report_contract")?.ready, true);
  assert.equal(result.checks.find((item) => item.id === "provider_adapter")?.ready, false);
  assert.equal(result.checks.find((item) => item.id === "paid_approval")?.ready, false);
  assert.equal(result.readyForLiveStt, false);
});
