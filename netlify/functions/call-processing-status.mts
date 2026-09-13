import type { Config, Context } from "@netlify/functions";
import { CALL_ANALYSIS_CONTRACT_VERSION } from "../shared/call-analysis-contract.mjs";
import { evaluatePaidProcessingGate } from "../shared/paid-feature-gate.mjs";
import { defaultProviderRegistry } from "../shared/provider-adapter-contract.mjs";
import { buildCurrentSttReadiness } from "../shared/stt-readiness.mjs";

export default async (_req: Request, _context: Context) => {
  const gate = evaluatePaidProcessingGate({
    PAID_PROCESSING_ENABLED: Netlify.env.get("PAID_PROCESSING_ENABLED"),
    PAID_PROCESSING_APPROVAL_COUNT: Netlify.env.get("PAID_PROCESSING_APPROVAL_COUNT"),
  });
  const providerId = Netlify.env.get("CALL_STT_PROVIDER") || "";
  const providerLimitsConfirmed = String(Netlify.env.get("CALL_STT_LIMITS_CONFIRMED") || "").toLowerCase() === "true";
  const readiness = buildCurrentSttReadiness({
    paidGate: gate,
    contractVersion: CALL_ANALYSIS_CONTRACT_VERSION,
    registry: defaultProviderRegistry(),
    providerId,
    providerLimitsConfirmed,
    tempStorageConfigured: false,
    usageLedgerConfigured: false,
    pipelineConfigured: false,
  });

  return Response.json({
    paidProcessingEnabled: gate.enabled,
    approvalCount: gate.approvalCount,
    requiredApprovals: gate.requiredApprovals,
    reason: gate.reason,
    pipelineConfigured: false,
    originalAudioPermanentStorage: false,
    directUploadRequired: true,
    functionAudioBodyUploadAllowed: false,
    maxTemporaryAudioRetentionHours: 24,
    analysisContractVersion: CALL_ANALYSIS_CONTRACT_VERSION,
    selectedSttProvider: readiness.providerSelection.providerId || null,
    sttReadiness: readiness,
  });
};

export const config: Config = {
  path: "/api/call-processing-status",
};
