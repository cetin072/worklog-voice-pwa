import { normalizeCallAnalysisResult } from "./call-analysis-normalize.mjs";
import { transitionProcessingJob } from "./call-processing-state.mjs";
import { tempAudioDisposition, transcriptDeleteAfter } from "../../public/call-processing-policy.mjs";

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

async function recordReturnedUsage(deps, value, job) {
  if (typeof deps?.recordUsage !== "function") return;
  const usage = Array.isArray(value?.usage) ? value.usage : value?.usage ? [value.usage] : [];
  for (const item of usage) {
    await deps.recordUsage({
      ...item,
      requestId: item?.requestId || job.requestId || "",
      relatedType: item?.relatedType || job.kind || "call",
    });
  }
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

export async function runCallProcessingPipeline(input = {}, deps = {}) {
  const uploadTemp = required(deps, "uploadTemp");
  const transcribe = required(deps, "transcribe");
  const analyze = required(deps, "analyze");
  const persistResult = required(deps, "persistResult");
  const deleteTemp = required(deps, "deleteTemp");

  const policy = input.policy || {};
  let job = { ...(input.job || {}) };
  if (job.status !== "queued") throw new Error("새 파이프라인은 queued 상태에서 시작해야 합니다.");

  job = transitionProcessingJob(job, "uploading", nowDate(deps));
  await saveJob(deps, job);

  let uploaded;
  try {
    uploaded = await uploadTemp({ job, source: input.source });
    if (!uploaded?.objectPath) throw new Error("임시 업로드 경로가 없습니다.");
    await recordReturnedUsage(deps, uploaded, job);
    const uploadedAt = uploaded.uploadedAt ? new Date(uploaded.uploadedAt) : nowDate(deps);
    const absoluteExpiry = new Date(uploadedAt.getTime() + Math.min(24, Number(policy.maxTempRetentionHours) || 24) * 3600_000);
    job = {
      ...job,
      tempObjectPath: String(uploaded.objectPath),
      tempCreatedAt: uploadedAt.toISOString(),
      tempExpiresAt: absoluteExpiry.toISOString(),
    };
    job = transitionProcessingJob(job, "transcribing", nowDate(deps));
    await saveJob(deps, job);
  } catch (error) {
    return retryWait(job, "uploading", error, deps, policy);
  }

  let transcription;
  try {
    transcription = await transcribe({ job, objectPath: job.tempObjectPath });
    const transcript = String(transcription?.transcript || "").trim();
    if (!transcript) throw new Error("STT 결과가 비어 있습니다.");
    transcription = { ...transcription, transcript };
    await recordReturnedUsage(deps, transcription, job);
    job = transitionProcessingJob(job, "analyzing", nowDate(deps));
    await saveJob(deps, job);
  } catch (error) {
    return retryWait(job, "transcribing", error, deps, policy);
  }

  let analysisResult;
  try {
    const analyzed = await analyze({ job, transcript: transcription.transcript });
    await recordReturnedUsage(deps, analyzed, job);
    analysisResult = normalizeCallAnalysisResult(analyzed?.analysis || analyzed, {
      recordedAt: input.recordedAt || job.sourceStartedAt || job.createdAt,
    });
    job = transitionProcessingJob(job, "persisting", nowDate(deps));
    await saveJob(deps, job);
  } catch (error) {
    return retryWait(job, "analyzing", error, deps, policy);
  }

  let persisted;
  try {
    const persistedAt = nowDate(deps);
    persisted = await persistResult({
      job,
      transcript: transcription.transcript,
      analysis: analysisResult,
      transcriptDeleteAfter: transcriptDeleteAfter(persistedAt, policy),
      transcriptRetention: policy.transcriptRetention || "keep",
    });
    await recordReturnedUsage(deps, persisted, job);
    job = {
      ...job,
      callId: String(persisted?.callId || ""),
    };
    job = transitionProcessingJob(job, "cleanup_pending", nowDate(deps));
    await saveJob(deps, job);
  } catch (error) {
    return retryWait(job, "persisting", error, deps, policy);
  }

  try {
    await deleteTemp({ job, objectPath: job.tempObjectPath });
    job = {
      ...job,
      tempObjectPath: null,
      tempExpiresAt: null,
      errorCode: null,
      errorMessage: null,
    };
    job = transitionProcessingJob(job, "completed", nowDate(deps));
    await saveJob(deps, job);
    return {
      ok: true,
      cleanupPending: false,
      job,
      callId: job.callId,
      transcript: transcription.transcript,
      analysis: analysisResult,
    };
  } catch (error) {
    const info = errorInfo(error);
    const disposition = tempAudioDisposition("cleanup_pending", nowDate(deps), policy, job.tempCreatedAt);
    job = {
      ...job,
      errorCode: "TEMP_DELETE_FAILED",
      errorMessage: info.message,
      tempExpiresAt: disposition.deleteAfter,
    };
    await saveJob(deps, job);
    return {
      ok: true,
      cleanupPending: true,
      job,
      callId: job.callId,
      transcript: transcription.transcript,
      analysis: analysisResult,
      cleanupError: info,
    };
  }
}
