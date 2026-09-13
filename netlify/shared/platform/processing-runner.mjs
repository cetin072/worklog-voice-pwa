import {
  incrementProcessingAttempt,
  normalizeProcessingJob,
  setProcessingCheckpoint,
  transitionProcessingJob,
} from "./processing-job.mjs";

const STAGE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function runnerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorInfo(error) {
  if (error && typeof error === "object") {
    return {
      code: String(error.code || error.name || "PROCESSING_STAGE_ERROR").slice(0, 100),
      message: String(error.message || "처리 중 오류가 발생했습니다.").slice(0, 1000),
    };
  }
  return {
    code: "PROCESSING_STAGE_ERROR",
    message: String(error || "처리 중 오류가 발생했습니다.").slice(0, 1000),
  };
}

function normalizeStageDefinitions(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw runnerError("PROCESSING_RUNNER_STAGES_REQUIRED", "Processing runner stage가 필요합니다.");
  }
  const seen = new Set();
  return stages.map((stage) => {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      throw runnerError("PROCESSING_RUNNER_STAGE_INVALID", "Processing runner stage 정의가 올바르지 않습니다.");
    }
    const name = String(stage.name || "").trim().toLowerCase();
    if (!STAGE_PATTERN.test(name)) {
      throw runnerError("PROCESSING_RUNNER_STAGE_INVALID", "Processing runner stage 이름이 올바르지 않습니다.");
    }
    if (seen.has(name)) {
      throw runnerError("PROCESSING_RUNNER_STAGE_DUPLICATE", `중복 stage: ${name}`);
    }
    if (typeof stage.run !== "function") {
      throw runnerError("PROCESSING_RUNNER_STAGE_RUN_REQUIRED", `${name} stage run 함수가 필요합니다.`);
    }
    const checkpointKey = String(stage.checkpointKey || name).trim().toLowerCase();
    if (!STAGE_PATTERN.test(checkpointKey)) {
      throw runnerError("PROCESSING_RUNNER_CHECKPOINT_KEY_INVALID", `${name} checkpoint key가 올바르지 않습니다.`);
    }
    seen.add(name);
    return Object.freeze({
      name,
      run: stage.run,
      checkpoint: stage.checkpoint !== false,
      checkpointKey,
    });
  });
}

async function saveJob(deps, job) {
  if (typeof deps?.saveJob !== "function") {
    throw runnerError(
      "PROCESSING_RUNNER_SAVE_JOB_REQUIRED",
      "Processing runner에는 saveJob dependency가 필요합니다.",
    );
  }
  await deps.saveJob(job);
  return job;
}

async function recordReturnedUsage(deps, value, job, warnings) {
  if (typeof deps?.recordUsage !== "function") return;
  const usage = Array.isArray(value?.usage) ? value.usage : value?.usage ? [value.usage] : [];
  for (const item of usage) {
    try {
      await deps.recordUsage({
        ...item,
        jobId: item?.jobId || job.jobId,
        requestId: item?.requestId || job.requestId,
        userId: item?.userId || job.userId,
        workspaceId: item?.workspaceId || job.workspaceId,
        relatedType: item?.relatedType || job.kind,
      });
    } catch (error) {
      // 이미 성공한 stage/provider 호출을 Usage 기록 실패 때문에 다시 실행하지 않는다.
      warnings.push(errorInfo(error));
    }
  }
}

function hasCheckpoint(job, key) {
  return Object.prototype.hasOwnProperty.call(job.checkpoints || {}, key);
}

function checkpointValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, "checkpoint")) {
    return value.checkpoint;
  }
  return value === undefined ? true : value;
}

export async function runProcessingStages(input = {}, deps = {}) {
  const stages = normalizeStageDefinitions(input.stages);
  let job = normalizeProcessingJob(input.job);
  if (!["queued", "processing"].includes(job.status)) {
    throw runnerError(
      "PROCESSING_RUNNER_JOB_NOT_RUNNABLE",
      `실행할 수 없는 Job status: ${job.status}`,
    );
  }

  let startIndex = 0;
  if (job.status === "processing") {
    startIndex = stages.findIndex((stage) => stage.name === job.stage);
    if (startIndex < 0) {
      throw runnerError(
        "PROCESSING_RUNNER_RESUME_STAGE_UNKNOWN",
        `resume stage를 찾을 수 없습니다: ${job.stage}`,
      );
    }
  }

  const usageWarnings = [];
  job = incrementProcessingAttempt(job, deps.now?.() ?? new Date());
  await saveJob(deps, job);

  for (let index = startIndex; index < stages.length; index += 1) {
    const stage = stages[index];
    if (job.status === "queued" || job.stage !== stage.name || job.errorCode || job.errorMessage) {
      job = transitionProcessingJob(
        job,
        { status: "processing", stage: stage.name },
        deps.now?.() ?? new Date(),
      );
      await saveJob(deps, job);
    }

    if (stage.checkpoint && hasCheckpoint(job, stage.checkpointKey)) continue;

    try {
      const value = await stage.run({
        job,
        input: input.payload ?? input.input ?? {},
        checkpoints: job.checkpoints,
      });
      if (stage.checkpoint) {
        job = setProcessingCheckpoint(
          job,
          stage.checkpointKey,
          checkpointValue(value),
          deps.now?.() ?? new Date(),
        );
        // checkpoint를 Usage 기록보다 먼저 저장해 Usage 실패가 provider 재실행으로 이어지지 않게 한다.
        await saveJob(deps, job);
      }
      await recordReturnedUsage(deps, value, job, usageWarnings);
    } catch (error) {
      const info = errorInfo(error);
      job = transitionProcessingJob(
        job,
        {
          status: "processing",
          stage: stage.name,
          errorCode: info.code,
          errorMessage: info.message,
        },
        deps.now?.() ?? new Date(),
      );
      await saveJob(deps, job);
      return { ok: false, stage: stage.name, job, error: info, usageWarnings };
    }
  }

  job = transitionProcessingJob(job, { status: "completed" }, deps.now?.() ?? new Date());
  await saveJob(deps, job);
  return { ok: true, job, usageWarnings };
}
