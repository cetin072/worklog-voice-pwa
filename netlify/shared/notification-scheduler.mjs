function schedulerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function httpsOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function text(value, max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function optionalHttpStatus(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
}

function cleanClaim(row) {
  const deliveryId = text(row?.delivery_id, 80);
  const subscriptionId = text(row?.subscription_id, 80);
  const endpoint = text(row?.endpoint, 2048);
  const p256dh = text(row?.p256dh, 512);
  const auth = text(row?.auth_secret, 256);
  const todayCount = nonNegativeInteger(row?.today_count);
  const overdueCount = nonNegativeInteger(row?.overdue_count);
  const scheduleCount = nonNegativeInteger(row?.schedule_count);
  const detailEnabled = row?.morning_detail_enabled !== false;
  const primaryWorkTitle = text(row?.primary_work_title, 200);
  const primaryWorkBucket = text(row?.primary_work_bucket, 20);
  const primaryScheduleTitle = text(row?.primary_schedule_title, 200);
  const primaryScheduleTime = text(row?.primary_schedule_time, 10);
  if (!deliveryId || !subscriptionId || !endpoint || !p256dh || !auth || todayCount === null || overdueCount === null || scheduleCount === null) {
    throw schedulerError("NOTIFICATION_CLAIM_INVALID", "알림 전송 대상 정보가 올바르지 않습니다.");
  }
  if (primaryWorkBucket && !["today", "overdue"].includes(primaryWorkBucket)) {
    throw schedulerError("NOTIFICATION_CLAIM_INVALID", "알림 업무 분류가 올바르지 않습니다.");
  }
  if (primaryScheduleTime && primaryScheduleTime !== "종일" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(primaryScheduleTime)) {
    throw schedulerError("NOTIFICATION_CLAIM_INVALID", "알림 일정 시각이 올바르지 않습니다.");
  }
  return Object.freeze({
    deliveryId,
    subscriptionId,
    endpoint,
    p256dh,
    auth,
    todayCount,
    overdueCount,
    scheduleCount,
    detailEnabled,
    primaryWorkTitle,
    primaryWorkBucket,
    primaryScheduleTitle,
    primaryScheduleTime,
  });
}

export function notificationSchedulerConfig(readEnv) {
  const read = typeof readEnv === "function" ? readEnv : () => undefined;
  const supabaseUrl = httpsOrigin(read("SUPABASE_URL"));
  const schedulerSecret = text(read("NOTIFICATION_SCHEDULER_SECRET"), 500);
  return Object.freeze({
    configured: Boolean(supabaseUrl && schedulerSecret.length >= 32),
    supabaseUrl,
    schedulerSecret,
  });
}

export function createNotificationSchedulerClient({ supabaseUrl, schedulerSecret, fetchImpl = fetch } = {}) {
  const origin = httpsOrigin(supabaseUrl);
  const secret = text(schedulerSecret, 500);
  if (!origin || secret.length < 32) throw schedulerError("NOTIFICATION_SCHEDULER_CONFIG_INVALID", "알림 스케줄러 설정이 올바르지 않습니다.");
  if (typeof fetchImpl !== "function") throw schedulerError("NOTIFICATION_SCHEDULER_FETCH_REQUIRED", "알림 스케줄러 fetch 구현이 필요합니다.");

  async function gateway(action, body) {
    const response = await fetchImpl(`${origin}/functions/v1/notification-scheduler-gateway`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worklog-scheduler-secret": secret,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = schedulerError(
        "NOTIFICATION_SCHEDULER_GATEWAY_FAILED",
        String(data?.message || `${action} 요청에 실패했습니다.`),
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function claim(action, appOrigin, localDate, label) {
    const targetOrigin = httpsOrigin(appOrigin);
    if (!targetOrigin) throw schedulerError("NOTIFICATION_APP_ORIGIN_INVALID", "알림 대상 앱 origin이 올바르지 않습니다.");
    const data = await gateway(action, {
      appOrigin: targetOrigin,
      localDate: localDate || null,
    });
    if (!Array.isArray(data)) throw schedulerError("NOTIFICATION_CLAIM_RESPONSE_INVALID", `${label} 알림 claim 결과가 올바르지 않습니다.`);
    return Object.freeze(data.map(cleanClaim));
  }

  return Object.freeze({
    async claimMorning({ appOrigin, localDate = null } = {}) {
      return claim("claim_morning", appOrigin, localDate, "아침");
    },

    async claimAfternoon({ appOrigin, localDate = null } = {}) {
      return claim("claim_afternoon", appOrigin, localDate, "오후");
    },

    async finish({ deliveryId, success, status = null, code = null } = {}) {
      const id = text(deliveryId, 80);
      if (!id || typeof success !== "boolean") throw schedulerError("NOTIFICATION_FINISH_INVALID", "알림 완료 기록 값이 올바르지 않습니다.");
      const data = await gateway("finish", {
        deliveryId: id,
        success,
        status: optionalHttpStatus(status),
        code: code ? text(code, 80) : null,
      });
      if (data !== true) throw schedulerError("NOTIFICATION_FINISH_REJECTED", "알림 완료 기록을 반영하지 못했습니다.");
      return true;
    },
  });
}
