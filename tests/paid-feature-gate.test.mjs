import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePaidProcessingGate } from "../netlify/shared/paid-feature-gate.mjs";

test("기본값은 유료 처리 잠금이다", () => {
  const gate = evaluatePaidProcessingGate({});
  assert.equal(gate.enabled, false);
  assert.equal(gate.reason, "paid_processing_disabled");
  assert.equal(gate.requiredApprovals, 2);
});

test("활성화만 해도 승인 2명이 없으면 잠금이다", () => {
  const gate = evaluatePaidProcessingGate({
    PAID_PROCESSING_ENABLED: "true",
    PAID_PROCESSING_APPROVAL_COUNT: "1",
  });
  assert.equal(gate.enabled, false);
  assert.equal(gate.reason, "insufficient_approvals");
});

test("활성화와 승인 2명이 모두 충족되어야 열린다", () => {
  const gate = evaluatePaidProcessingGate({
    PAID_PROCESSING_ENABLED: "true",
    PAID_PROCESSING_APPROVAL_COUNT: "2",
  });
  assert.equal(gate.enabled, true);
  assert.equal(gate.reason, "approved");
});
