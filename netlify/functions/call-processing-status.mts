import type { Config, Context } from "@netlify/functions";
import { evaluatePaidProcessingGate } from "../shared/paid-feature-gate.mjs";

export default async (_req: Request, _context: Context) => {
  const gate = evaluatePaidProcessingGate({
    PAID_PROCESSING_ENABLED: Netlify.env.get("PAID_PROCESSING_ENABLED"),
    PAID_PROCESSING_APPROVAL_COUNT: Netlify.env.get("PAID_PROCESSING_APPROVAL_COUNT"),
  });

  return Response.json({
    paidProcessingEnabled: gate.enabled,
    approvalCount: gate.approvalCount,
    requiredApprovals: gate.requiredApprovals,
    reason: gate.reason,
    pipelineConfigured: false,
    originalAudioPermanentStorage: false,
    maxTemporaryAudioRetentionHours: 24,
  });
};

export const config: Config = {
  path: "/api/call-processing-status",
};
