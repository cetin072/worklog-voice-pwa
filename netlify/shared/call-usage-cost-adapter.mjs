import { normalizeProcessingJob } from "./platform/processing-job.mjs";
import { normalizeUsageEvent } from "./platform/usage-event.mjs";
import {
  assertCostGateAllowed,
  evaluateApprovalCostGate,
} from "./platform/cost-gate.mjs";

export const CALL_PAID_PROCESSING_REQUIRED_APPROVALS = 2;

function callUsageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function legacyInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function defaultCallFeature(service) {
  if (service === "stt") return "call_transcription";
  if (service === "ai") return "call_summary";
  if (service === "storage") return "call_storage";
  return "call_processing";
}

function requireCallJob(jobInput) {
  const job = normalizeProcessingJob(jobInput);
  if (job.kind !== "call") {
    throw callUsageError("CALL_PROCESSING_JOB_REQUIRED", "통화 Processing Job이 필요합니다.");
  }
  return job;
}

function usageItems(value) {
  if (Array.isArray(value?.usage)) return value.usage;
  return value?.usage ? [value.usage] : [];
}

function sameCanonicalEvent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Adapts usage returned by Call processors/storage into the canonical Platform
 * Usage Event V1 contract. Ownership/request/event identity comes from the Call
 * Processing Job and Platform rules rather than provider-controlled payloads.
 */
export function normalizeCallUsageEvents(value = {}, context = {}) {
  const source = record(value);
  const job = requireCallJob(context.job);
  const observedAt = context.now ?? new Date();
  const fallbackProviderRequestId = text(source.providerRequestId ?? source.provider_request_id);
  const callId = text(context.callId ?? source.callId ?? source.call_id);
  const unique = new Map();

  for (const rawItem of usageItems(source)) {
    const item = record(rawItem);
    const service = text(item.service ?? item.category ?? context.service).toLowerCase();
    const providerRequestId = text(
      item.providerRequestId ?? item.provider_request_id ?? fallbackProviderRequestId,
    );
    const event = normalizeUsageEvent({
      ...item,
      id: undefined,
      eventKey: undefined,
      event_key: undefined,
      requestId: job.requestId,
      jobId: job.jobId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      feature: text(item.feature) || defaultCallFeature(service),
      service,
      operation: item.operation ?? context.operation,
      providerRequestId,
      relatedType: "call",
      relatedId: text(item.relatedId ?? item.related_id) || callId,
    }, { now: observedAt });

    const previous = unique.get(event.eventKey);
    if (!previous) {
      unique.set(event.eventKey, event);
      continue;
    }
    if (!sameCanonicalEvent(previous, event)) {
      throw callUsageError(
        "CALL_USAGE_EVENT_KEY_CONFLICT",
        `같은 Usage Event key에 서로 다른 통화 사용량이 들어왔습니다: ${event.eventKey}`,
      );
    }
  }

  return Object.freeze([...unique.values()]);
}

/**
 * Preserves the legacy Call paid-processing switch + two-approval policy while
 * delegating the actual decision contract to Platform Cost Gate V1.
 */
export function evaluateCallPaidProcessingCostGate(values = {}, context = {}) {
  const explicitlyEnabled = String(values.PAID_PROCESSING_ENABLED || "").toLowerCase() === "true";
  const approvalCount = Math.max(0, legacyInteger(values.PAID_PROCESSING_APPROVAL_COUNT, 0));

  return evaluateApprovalCostGate({
    feature: context.feature ?? "call_processing",
    service: context.service ?? "stt_ai",
    explicitlyEnabled,
    approvalCount,
    requiredApprovals: CALL_PAID_PROCESSING_REQUIRED_APPROVALS,
    workspaceContext: context.workspaceContext,
    evaluatedAt: context.now,
  });
}

export function assertCallPaidProcessingAllowed(values = {}, context = {}) {
  return assertCostGateAllowed(evaluateCallPaidProcessingCostGate(values, context));
}
