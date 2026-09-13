import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCostGateAllowed,
  createUnconfiguredCostGateEvaluator,
  evaluateApprovalCostGate,
  normalizeCostGateDecision,
} from "../netlify/shared/platform/cost-gate.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };
const now = new Date("2026-09-14T00:00:00Z");

function approval(overrides = {}) {
  return {
    feature: "call_transcription",
    service: "stt",
    explicitlyEnabled: true,
    approvalCount: 2,
    requiredApprovals: 2,
    workspaceContext,
    evaluatedAt: now,
    ...overrides,
  };
}

test("기존 call approval gate 의미를 caller 명시 정책으로 평가한다", () => {
  const decision = evaluateApprovalCostGate(approval());
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "approved");
  assert.equal(decision.userId, "user-1");
  assert.equal(decision.workspaceId, "workspace-1");
  assert.equal(decision.role, "owner");
  assert.equal(decision.metadata.approvalCount, 2);
  assert.equal(decision.metadata.requiredApprovals, 2);
});

test("explicit enable이 꺼져 있으면 승인 수가 충분해도 차단한다", () => {
  const decision = evaluateApprovalCostGate(approval({ explicitlyEnabled: false, approvalCount: 10 }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "paid_processing_disabled");
});

test("승인이 부족하면 insufficient_approvals", () => {
  const decision = evaluateApprovalCostGate(approval({ approvalCount: 1 }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "insufficient_approvals");
});

test("Platform은 requiredApprovals=2를 숨은 기본값으로 넣지 않는다", () => {
  const input = approval();
  delete input.requiredApprovals;
  assert.throws(
    () => evaluateApprovalCostGate(input),
    (e) => e?.code === "COST_GATE_REQUIRED_APPROVALS_REQUIRED",
  );
});

test("approvalCount/requiredApprovals는 명시적 정수 범위를 검증한다", () => {
  assert.throws(
    () => evaluateApprovalCostGate(approval({ approvalCount: 1.5 })),
    (e) => e?.code === "COST_GATE_APPROVAL_COUNT_INVALID",
  );
  assert.throws(
    () => evaluateApprovalCostGate(approval({ requiredApprovals: -1 })),
    (e) => e?.code === "COST_GATE_REQUIRED_APPROVALS_INVALID",
  );
});

test("Cost Gate Decision은 Workspace Context와 strict boolean을 요구한다", () => {
  assert.throws(
    () => normalizeCostGateDecision({ feature: "x", service: "ai", allowed: "yes", reason: "approved" }, { workspaceContext }),
    (e) => e?.code === "COST_GATE_ALLOWED_REQUIRED",
  );
  assert.throws(
    () => normalizeCostGateDecision({ feature: "x", service: "ai", allowed: true, reason: "approved" }),
    (e) => e?.code === "WORKSPACE_CONTEXT_USER_REQUIRED",
  );
});

test("assertCostGateAllowed는 normalized decision을 다시 검증하고 허용된 경우 그대로 통과시킨다", () => {
  const decision = evaluateApprovalCostGate(approval());
  const verified = assertCostGateAllowed(decision);
  assert.equal(verified.allowed, true);
  assert.equal(verified.role, "owner");
});

test("assertCostGateAllowed는 거부 decision을 fail-closed한다", () => {
  const decision = evaluateApprovalCostGate(approval({ approvalCount: 0 }));
  assert.throws(
    () => assertCostGateAllowed(decision),
    (e) => e?.code === "COST_GATE_NOT_ALLOWED" && e?.reason === "insufficient_approvals",
  );
});

test("feature/service/reason token과 metadata를 검증한다", () => {
  assert.throws(
    () => normalizeCostGateDecision({ feature: "bad feature", service: "ai", allowed: true, reason: "approved" }, { workspaceContext }),
    (e) => e?.code === "COST_GATE_FEATURE_INVALID",
  );
  assert.throws(
    () => normalizeCostGateDecision({ feature: "x", service: "ai", allowed: true, reason: "approved", metadata: [] }, { workspaceContext }),
    (e) => e?.code === "COST_GATE_METADATA_INVALID",
  );
});

test("미연결 Cost Gate evaluator는 fail-closed", async () => {
  const evaluator = createUnconfiguredCostGateEvaluator();
  await assert.rejects(
    () => evaluator.evaluate({}),
    (e) => e?.code === "COST_GATE_EVALUATOR_NOT_CONFIGURED",
  );
});
