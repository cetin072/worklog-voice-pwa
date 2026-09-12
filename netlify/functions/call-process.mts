import type { Config, Context } from "@netlify/functions";
import { evaluatePaidProcessingGate } from "../shared/paid-feature-gate.mjs";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const gate = evaluatePaidProcessingGate({
    PAID_PROCESSING_ENABLED: Netlify.env.get("PAID_PROCESSING_ENABLED"),
    PAID_PROCESSING_APPROVAL_COUNT: Netlify.env.get("PAID_PROCESSING_APPROVAL_COUNT"),
  });

  if (!gate.enabled) {
    return json(423, {
      ok: false,
      error: "paid_processing_locked",
      reason: gate.reason,
      approvalCount: gate.approvalCount,
      requiredApprovals: gate.requiredApprovals,
      message: "유료 STT·AI 처리는 개발자 2인 승인 전까지 잠겨 있습니다.",
    });
  }

  // 승인 게이트가 열리더라도 실제 STT/AI·스토리지·DB 파이프라인을
  // 별도 작업으로 연결하기 전에는 파일 본문을 읽거나 외부 서비스를 호출하지 않는다.
  return json(501, {
    ok: false,
    error: "pipeline_not_configured",
    message: "승인 상태이지만 실제 통화 처리 파이프라인은 아직 연결되지 않았습니다.",
  });
};

export const config: Config = {
  path: "/api/call-process",
};
