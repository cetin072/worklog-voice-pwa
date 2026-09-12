export const REQUIRED_PAID_PROCESSING_APPROVALS = 2;

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

export function evaluatePaidProcessingGate(values = {}) {
  const explicitlyEnabled = String(values.PAID_PROCESSING_ENABLED || "").toLowerCase() === "true";
  const approvalCount = Math.max(0, integer(values.PAID_PROCESSING_APPROVAL_COUNT, 0));
  const enabled = explicitlyEnabled && approvalCount >= REQUIRED_PAID_PROCESSING_APPROVALS;
  return {
    enabled,
    explicitlyEnabled,
    approvalCount,
    requiredApprovals: REQUIRED_PAID_PROCESSING_APPROVALS,
    reason: enabled
      ? "approved"
      : !explicitlyEnabled
        ? "paid_processing_disabled"
        : "insufficient_approvals",
  };
}
