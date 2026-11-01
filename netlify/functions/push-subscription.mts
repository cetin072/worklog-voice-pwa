import type { Config } from "@netlify/functions";

// PWA Web Push retired: do not register, send, or mutate existing subscriptions.
export default async () => new Response(
  JSON.stringify({ error: "WEB_PUSH_RETIRED", message: "업무수첩 웹앱 알림 서비스가 종료되었습니다." }),
  { status: 410, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
);

export const config: Config = { path: "/api/push-subscription" };
