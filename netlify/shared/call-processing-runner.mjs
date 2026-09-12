import { normalizeCallAnalysisResult } from "./call-analysis-normalize.mjs";
import { transitionProcessingJob } from "./call-processing-state.mjs";
import { tempAudioDisposition, transcriptDeleteAfter } from "../../public/call-processing-policy.mjs";

const RETRY_STAGES = new Set(["uploading", "transcribing", "analyzing", "persisting"]);

function required(deps, name) {
  if (typeof deps?.[name] !== "function") throw new TypeError(`처리 어댑터 ${name}이 필요합니다.`);
  return deps[name];
}

function nowDate(deps) {
  const value = typeof deps?.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("유효한 처리 시각이 필요합니다.");
  return date;
}

async function saveJob(deps, job) {
  if (typeof deps?.saveJob === "function") await deps.saveJob(job);
  return job;
}

function errorInfo(error) {
  if (error && typeof error === "object") {
    return {
      code: String(error.code || error.name || "PROCESSING_ERROR").slice(0, 100),
      message: String(error.message || "처리 중 오류가 발생했습니다.").slice(0, 1000),
    };
  }
  return { code: "PROCESSING_ERROR", message: String(error || "처리 중 오류가 발생했습니다.").slice(0, 1000) };
}

async function recordReturnedUsage(deps, value, job, warnings) {
  if (typeof deps?.recordUsage !== "function") return;
  const usage = Array.isArray(value?.usage) ? value.usage : value?.usage ? [value.usage] : [];
  for (const item of usage) {
    try {
      await deps.recordUsage({
        ...item,
        requestId: item?.requestId || job.requestId || "",
        relatedType: item?.relatedType || job.kind || "call",
      });
    } catch (error) {
      // 이미 비용이 발생한 공급자 호출을 사용량 기록 실패 때문에 다시 실행하면 안 된다.
      warnings.push(errorInfo(error));
    }
  }
}

async function enterStage(job, stage, deps) {
  if (job.status === stage) return job;
  const next = transitionProcessingJob(job, stage, nowDate(deps));
  await saveJob(deps, next);
  return next;
}

async function advanceStage(job, stage, deps) {
  const next = transitionProcessingJob(job, stage, nowDate(deps));
  await saveJob(deps, next);
  return next;
}

async function retryWait(job, stage, error, deps, policy) {
  const time = nowDate(deps);
  const info = errorInfo(error);
  let next = transitionProcessingJob(job, "retry_wait", time);
  const tempCreatedAt = next.tempCreatedAt || time.toISOString();
  const disposition = next.tempObjectPath
    ? tempAudioDisposition("retry_wait", time, policy, tempCreatedAt)
    : { deleteAfter: null };
  next = {
    ...next,
    retryStage: stage,
    errorCode: info.code,
    errorMessage: info.message,
    tempExpiresAt: disposition.deleteAfter,
  };
  await saveJob(deps, next);
  return { ok: false, stage, job: next, error: info };
}

async function cleanupPersistedJob(job, deps, policy, payload = {}) {
  const deleteTemp = required(deps, "deleteTemp");
  if (!job.tempObjectPath) {
    const completed = await advanceStage({ ...job, tempExpiresAt: null }, "completed", deps);
    return { ok: true, cleanupPending: false, job: completed, ...payload };
  }

  try {
    await deleteTemp({ job, objectPath: job.tempObjectPath });
    const cleared = {
      ...job,
      tempObjectPath: null,
      tempExpiresAt: null,
      errorCode: null,
      errorMessage: null,
    };
    const completed = await advanceStage(cleared, "completed", deps);
    return { ok: true, cleanupPending: false, job: completed, ...payload };
  } catch (error) {
    const info = errorInfo(error);
    const disposition = tempAudioDisposition("cleanup_pending", nowDate(deps), policy, job.tempCreatedAt);
    const pending = {
      ...job,
      errorCode: "TEMP_DELETE_FAILED",
      errorMessage: info.message,
      tempExpiresAt: disposition.deleteAfter,
    };
    await saveJob(deps, pending);
    return {
      ok: true,
      cleanupPending: true,
      job: pending,
      cleanupError: info,
      ...payload,
    };
  }
}

async function executePipeline(input = {}, deps = {}, resume = false) {
  const uploadTemp = required(deps, "uploadTemp");
  const transcribe = required(deps, "transcribe");
  const analyze = required(deps, "analyze");
  const persistResult = required(deps, "persistResult");
  required(deps, "deleteTemp");

  const policy = input.policy || {};
  const usageWarnings = [];
  let job = { ...(input.job || {}) };
  let stage;

  if (!resume) {
    if (job.status !== "queued") throw new Error("새 파이프라인은 queued 상태에서 시작해야 합니다.");
    stage = "uploading";
  } else {
    if (job.status !== "retry_wait") throw new Error("재시도 파이프라인은 retry_wait 상태에서 시작해야 합니다.");
    stage = String(job.retryStage || "");
    if (!RETRY_STAGES.has(stage)) throw new Error(`지원하지 않는 재시도 단계: ${stage || "없음"}`);
  }

  let transcript = String(job.transcriptCheckpoint || "").trim();
  let analysisResult = job.analysisCheckpoint && typeof job.analysisCheckpoint === "object"
    ? job.analysisCheckpoint
    : null;

  if (stage === "uploading") {
    try {
      job = await enterStage(job, "uploading", deps);
      if (!job.tempObjectPath) {
        const uploaded = await uploadTemp({ job, source: input.source });
        if (!uploaded?.objectPath) throw new Error("임시 업로드 경로가 없습니다.");
        const uploadedAt = uploaded.uploadedAt ? new Date(uploaded.uploadedAt) : nowDate(deps);
        if (Number.isNaN(uploadedAt.getTime())) throw new Error("임시 업로드 시각이 올바르지 않습니다.");
        const maxHours = Math.min(24, Math.max(1, Number(policy.maxTempRetentionHours) || 24));
        const absoluteExpiry = new Date(uploadedAt.getTime() + maxHours * 3600_000);
        job = {
          ...job,
          tempObjectPath: String(uploaded.objectPath),
          tempCreatedAt: uploadedAt.toISOString(),
          tempExpiresAt: absoluteExpiry.toISOString(),
          errorCode: null,
          errorMessage: null,
        };
        await saveJob(deps, job);
        await recordReturnedUsage(deps, uploaded, job, usageWarnings);
      }
      job = await advanceStage(job, "transcribing", deps);
      stage = "transcribing";
    } catch (error) {
      return retryWait(job, "uploading", error, deps, policy);
    }
  }

  if (stage === "transcribing") {
    try {
      job = await enterStage(job, "transcribing", deps);
      if (!job.tempObjectPath) throw new Error("재시도할 임시 음성파일이 없습니다.");
      if (!transcript) {
        const transcription = await transcribe({ job, objectPath: job.tempObjectPath });
        transcript = String(transcription?.transcript || "").trim();
        if (!transcript) throw new Error("STT 결과가 비어 있습니다.");
        job = {
          ...job,
          transcriptCheckpoint: transcript,
          sttProviderRequestId: String(transcription?.providerRequestId || job.sttProviderRequestId || ""),
          errorCode: null,
          errorMessage: null,
        };
        await saveJob(deps, job);
        await recordReturnedUsage(deps, transcription, job, usageWarnings);
      }
      job = await advanceStage(job, "analyzing", deps);
      stage = "analyzing";
    } catch (error) {
      return retryWait(job, "transcribing", error, deps, policy);
    }
  }

  if (stage === "analyzing") {
    try {
      job = await enterStage(job, "analyzing", deps);
      transcript = transcript || String(job.transcriptCheckpoint || "").trim();
      if (!transcript) throw new Error("재사용할 STT 녹취 체크포인트가 없습니다.");
      if (!analysisResult) {
        const analyzed = await analyze({ job, transcript });
        analysisResult = normalizeCallAnalysisResult(analyzed?.analysis || analyzed, {
          recordedAt: input.recordedAt || job.sourceStartedAt || job.createdAt,
        });
        job = {
          ...job,
          analysisCheckpoint: analysisResult,
          aiProviderRequestId: String(analyzed?.providerRequestId || job.aiProviderRequestId || ""),
          errorCode: null,
          errorMessage: null,
        };
        await saveJob(deps, job);
        await recordReturnedUsage(deps, analyzed, job, usageWarnings);
      }
      job = await advanceStage(job, "persisting", deps);
      stage = "persisting";
    } catch (error) {
      return retryWait(job, "analyzing", error, deps, policy);
    }
  }

  if (stage === "persisting") {
    try {
      job = await enterStage(job, "persisting", deps);
      transcript = transcript || String(job.transcriptCheckpoint || "").trim();
      analysisResult = analysisResult || job.analysisCheckpoint;
      if (!transcript) throw new Error("최종 저장에 필요한 녹취 체크포인트가 없습니다.");
      if (!analysisResult || typeof analysisResult !== "object") throw new Error("최종 저장에 필요한 AI 분석 체크포인트가 없습니다.");

      const persistedAt = nowDate(deps);
      const persisted = await persistResult({
        job,
        transcript,
        analysis: analysisResult,
        transcriptDeleteAfter: transcriptDeleteAfter(persistedAt, policy),
        transcriptRetention: policy.transcriptRetention || "keep",
      });
      await recordReturnedUsage(deps, persisted, job, usageWarnings);
      job = {
        ...job,
        callId: String(persisted?.callId || job.callId || ""),
        transcriptCheckpoint: null,
        analysisCheckpoint: null,
        retryStage: null,
        errorCode: null,
        errorMessage: null,
      };
      job = await advanceStage(job, "cleanup_pending", deps);
    } catch (error) {
      return retryWait(job, "persisting", error, deps, policy);
    }
  }

  return cleanupPersistedJob(job, deps, policy, {
    callId: job.callId,
    transcript,
    analysis: analysisResult,
    usageWarnings,
    resumed: resume,
  });
}

export async function runCallProcessingPipeline(input = {}, deps = {}) {
  return executePipeline(input, deps, false);
}

export async function resumeCallProcessingPipeline(input = {}, deps = {}) {
  return executePipeline(input, deps, true);
}

export async function retryCallCleanup(input = {}, deps = {}) {
  const job = { ...(input.job || {}) };
  if (job.status !== "cleanup_pending") throw new Error("삭제 재시도는 cleanup_pending 상태에서만 가능합니다.");
  return cleanupPersistedJob(job, deps, input.policy || {}, {
    callId: job.callId || "",
    resumed: true,
    usageWarnings: [],
  });
}
