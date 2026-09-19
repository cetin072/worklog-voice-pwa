import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Input = {
  action?: unknown;
  appOrigin?: unknown;
  localDate?: unknown;
  deliveryId?: unknown;
  success?: unknown;
  status?: unknown;
  code?: unknown;
};

const SECRET_HEADER = "x-worklog-scheduler-secret";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function text(value: unknown, max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function httpsOrigin(value: unknown) {
  try {
    const url = new URL(text(value, 2048));
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function dateOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : "";
}

function statusOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : NaN;
}

function defaultSecretKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const preferred = text(parsed.default, 1000);
      if (preferred.startsWith("sb_secret_")) return preferred;
      for (const value of Object.values(parsed)) {
        const candidate = text(value, 1000);
        if (candidate.startsWith("sb_secret_")) return candidate;
      }
    } catch {
      // Fall through to the legacy service-role key during key migration.
    }
  }
  return text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), 2000);
}

function rpcRequest(input: Input, schedulerSecret: string) {
  const action = text(input.action, 40);

  if (action === "claim_morning" || action === "claim_afternoon") {
    const appOrigin = httpsOrigin(input.appOrigin);
    const localDate = dateOrNull(input.localDate);
    if (!appOrigin) throw new Error("APP_ORIGIN_INVALID");
    if (localDate === "") throw new Error("LOCAL_DATE_INVALID");
    return {
      name: action === "claim_morning"
        ? "claim_morning_notification_deliveries"
        : "claim_afternoon_notification_deliveries",
      body: {
        p_scheduler_secret: schedulerSecret,
        p_app_origin: appOrigin,
        p_local_date: localDate,
      },
    };
  }

  if (action === "finish") {
    const deliveryId = text(input.deliveryId, 80);
    const success = input.success;
    const status = statusOrNull(input.status);
    const code = input.code === null || input.code === undefined || input.code === "" ? null : text(input.code, 80);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deliveryId)) throw new Error("DELIVERY_ID_INVALID");
    if (typeof success !== "boolean") throw new Error("SUCCESS_INVALID");
    if (Number.isNaN(status)) throw new Error("STATUS_INVALID");
    return {
      name: "finish_notification_delivery",
      body: {
        p_scheduler_secret: schedulerSecret,
        p_delivery_id: deliveryId,
        p_success: success,
        p_status: status,
        p_code: code,
      },
    };
  }

  throw new Error("ACTION_INVALID");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const schedulerSecret = text(req.headers.get(SECRET_HEADER), 500);
  if (schedulerSecret.length < 32) return json(401, { error: "SCHEDULER_AUTH_REQUIRED" });

  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json(400, { error: "REQUEST_INVALID" });
  }

  let rpc;
  try {
    rpc = rpcRequest(input, schedulerSecret);
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : "REQUEST_INVALID" });
  }

  const supabaseUrl = httpsOrigin(Deno.env.get("SUPABASE_URL"));
  const secretKey = defaultSecretKey();
  if (!supabaseUrl || !secretKey) return json(503, { error: "SERVER_AUTH_NOT_CONFIGURED" });

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpc.name}`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(rpc.body),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error("notification scheduler gateway RPC failed", JSON.stringify({ action: text(input.action, 40), status: response.status }));
    return json(response.status === 401 || response.status === 403 ? 401 : 502, {
      error: "SCHEDULER_RPC_FAILED",
      message: "알림 스케줄러 요청을 처리하지 못했습니다.",
    });
  }

  return new Response(body || "null", {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
});
