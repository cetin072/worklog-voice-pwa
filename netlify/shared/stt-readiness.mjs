import { resolveSttProviderSelection } from "./stt-provider-selection.mjs";

const CHECK_DEFINITIONS = Object.freeze([
  ["report_contract", "통화 보고서·업무항목 분석 계약"],
  ["provider_selected", "STT 공급자 선택"],
  ["provider_limits", "공급자 업로드 한도 확인"],
  ["provider_adapter", "STT 공급자 어댑터 연결"],
  ["temporary_storage", "임시 음성 저장소 연결"],
  ["usage_ledger", "중앙 usage_events 기록 경로"],
  ["paid_approval", "개발자 2인 유료 승인"],
  ["pipeline", "업로드→STT→저장→삭제 파이프라인 연결"],
]);

function boolean(value) {
  return value === true;
}

export function evaluateSttReadiness(input = {}) {
  const flags = {
    report_contract: boolean(input.reportContractReady),
    provider_selected: boolean(input.providerSelected),
    provider_limits: boolean(input.providerLimitsConfirmed),
    provider_adapter: boolean(input.providerAdapterConfigured),
    temporary_storage: boolean(input.tempStorageConfigured),
    usage_ledger: boolean(input.usageLedgerConfigured),
    paid_approval: boolean(input.paidApprovalReady),
    pipeline: boolean(input.pipelineConfigured),
  };

  const checks = CHECK_DEFINITIONS.map(([id, label]) => ({ id, label, ready: flags[id] }));
  const readyCount = checks.filter((item) => item.ready).length;
  const blockers = checks.filter((item) => !item.ready).map((item) => item.id);

  return {
    readyForLiveStt: blockers.length === 0,
    readyCount,
    totalCount: checks.length,
    checks,
    blockers,
  };
}

export function buildCurrentSttReadiness({
  paidGate,
  contractVersion,
  registry,
  providerId = "",
  providerLimitsConfirmed = false,
  tempStorageConfigured = false,
  usageLedgerConfigured = false,
  pipelineConfigured = false,
} = {}) {
  const providerSelection = resolveSttProviderSelection({
    providerId,
    registry,
    limitsConfirmed: providerLimitsConfirmed,
  });

  return {
    ...evaluateSttReadiness({
      reportContractReady: String(contractVersion || "") === "v2",
      providerSelected: providerSelection.selected,
      providerLimitsConfirmed: providerSelection.limitsConfirmed,
      providerAdapterConfigured: providerSelection.adapterConfigured,
      tempStorageConfigured,
      usageLedgerConfigured,
      paidApprovalReady: paidGate?.enabled === true,
      pipelineConfigured,
    }),
    providerSelection,
  };
}
