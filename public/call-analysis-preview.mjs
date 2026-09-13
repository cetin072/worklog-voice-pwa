import {
  DEFAULT_STT_RATES,
  estimateSttCost,
  formatKrw,
  loadUsageSettings,
} from "./usage-meter.mjs";
import {
  TRANSCRIPT_RETENTION,
  loadCallProcessingPolicy,
} from "./call-processing-policy.mjs";
import { validateCallSelectionPreflight } from "./call-upload-preflight.mjs";

const actionButton = document.getElementById("callSelectionAction");
const summary = document.getElementById("callSelectionSummary");
let latestSelection = [];

function parseDurationSeconds(text = "") {
  if (!text.includes("총 녹음 길이")) return null;
  const hours = Number(text.match(/(\d+)시간/)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)분/)?.[1] || 0);
  const seconds = Number(text.match(/(\d+)초/)?.[1] || 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function transcriptRetentionLabel(value) {
  if (value === TRANSCRIPT_RETENTION.THIRTY_DAYS) return "30일 후 삭제";
  if (value === TRANSCRIPT_RETENTION.DELETE_AFTER_SUMMARY) return "요약 저장 후 전문 삭제";
  return "계속 보관";
}

function buildRateRow(rateId, rate, seconds, usdKrw) {
  const estimate = estimateSttCost(rateId, seconds, { usdKrw });
  const row = document.createElement("div");
  row.className = "call-cost-row";
  const name = document.createElement("span");
  name.textContent = `${rate.provider} · ${rate.model}`;
  const cost = document.createElement("strong");
  cost.textContent = estimate ? `약 ${formatKrw(estimate.estimatedKrw)}` : "계산 불가";
  row.append(name, cost);
  return row;
}

function selectionPreflightItems() {
  return latestSelection.map((item) => ({
    id: item.id,
    name: item.fileName,
    type: item.mimeType,
    size: item.fileSize,
    lastModified: item.lastModified,
    durationSeconds: item.durationSeconds || null,
  }));
}

function renderPreflight(box) {
  const items = selectionPreflightItems();
  if (!items.length) {
    const wait = document.createElement("p");
    wait.textContent = "파일 사전검사: 선택 메타데이터 확인 중";
    box.append(wait);
    return;
  }

  const result = validateCallSelectionPreflight(items, {
    providerId: "unselected",
    providerLimitsConfirmed: false,
    requireKnownDuration: false,
  });
  const line = document.createElement("p");
  line.className = result.localValid ? "call-preflight-ok" : "call-preflight-error";
  line.textContent = result.localValid
    ? `파일 사전검사: 통과 · ${result.totals.files}건 · 공급자 한도 확인 전`
    : `파일 사전검사: ${result.errors.length}개 문제 확인`;
  box.append(line);

  if (!result.localValid) {
    const list = document.createElement("ul");
    list.className = "call-preflight-list";
    result.errors.slice(0, 5).forEach((issue) => {
      const item = document.createElement("li");
      item.textContent = issue.fileName ? `${issue.fileName}: ${issue.message}` : issue.message;
      list.append(item);
    });
    box.append(list);
  }

  const provider = document.createElement("p");
  provider.textContent = "실제 STT 연결 전에는 공급자 선택과 최신 파일 크기·길이·MIME 한도 확인이 추가로 필요합니다.";
  box.append(provider);
}

function renderPreview() {
  if (!summary || summary.hidden || summary.querySelector(".call-analysis-preview")) return;

  const box = document.createElement("div");
  box.className = "call-analysis-preview";

  const heading = document.createElement("strong");
  heading.textContent = "STT 예상비용 · 사전검사 · 처리정책";
  box.append(heading);

  const durationText = summary.querySelector(".call-selection-duration")?.textContent || "";
  const seconds = parseDurationSeconds(durationText);
  if (seconds) {
    const settings = loadUsageSettings();
    const rateList = document.createElement("div");
    rateList.className = "call-cost-list";
    Object.entries(DEFAULT_STT_RATES).forEach(([rateId, rate]) => {
      rateList.append(buildRateRow(rateId, rate, seconds, settings.usdKrw));
    });
    box.append(rateList);

    const costNote = document.createElement("p");
    costNote.textContent = "현재 금액은 STT만 단순 계산한 예상치입니다. AI 보고서/요약 비용과 인프라 배분비는 아직 포함하지 않습니다.";
    box.append(costNote);
  } else {
    const wait = document.createElement("p");
    wait.textContent = "모든 녹음 길이가 확인되면 STT 예상비용을 계산합니다.";
    box.append(wait);
  }

  renderPreflight(box);

  const policy = loadCallProcessingPolicy();
  const audioPolicy = document.createElement("p");
  audioPolicy.textContent = `원본 음성: 정상 처리 후 즉시 삭제 · 실패 시 ${policy.failedTempRetentionHours}시간 임시보관 · 절대 상한 ${policy.maxTempRetentionHours}시간`;
  box.append(audioPolicy);

  const transcriptPolicy = document.createElement("p");
  transcriptPolicy.textContent = `녹취록: ${transcriptRetentionLabel(policy.transcriptRetention)}`;
  box.append(transcriptPolicy);

  const lock = document.createElement("p");
  lock.className = "call-paid-lock";
  lock.textContent = "🔒 실제 STT·AI 분석은 개발자 2인 승인 전까지 잠겨 있습니다. 현재는 파일을 전송하지 않습니다.";
  box.append(lock);

  summary.append(box);
}

function schedulePreview() {
  setTimeout(renderPreview, 0);
}

actionButton?.addEventListener("click", schedulePreview);

window.addEventListener("worklog:call-selection-ready", (event) => {
  latestSelection = Array.isArray(event.detail?.items) ? event.detail.items : [];
  if (summary?.querySelector(".call-analysis-preview")) {
    summary.querySelector(".call-analysis-preview")?.remove();
    schedulePreview();
  }
});

if (summary && typeof MutationObserver !== "undefined") {
  const observer = new MutationObserver(() => {
    if (!summary.hidden && !summary.querySelector(".call-analysis-preview")) schedulePreview();
  });
  observer.observe(summary, { childList: true, subtree: true, characterData: true });
}
