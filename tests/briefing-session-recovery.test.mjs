import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const authSource = readFileSync(new URL("../public/platform-auth.js", import.meta.url), "utf8");
const briefingSource = readFileSync(new URL("../public/briefing-v2.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

const publicConfig = {
  configured: true,
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "sb_publishable_example",
  dataCorePrimaryEnabled: true,
};

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function loadAuth({ localStorage, fetchImpl }) {
  const sessionStorage = createStorage();
  const location = { hash: "", pathname: "/", search: "", origin: "https://app.example", assign() {} };
  const window = { location, history: { replaceState() {} } };
  const context = {
    window,
    document: { title: "업무수첩" },
    localStorage,
    sessionStorage,
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    console,
    Date,
    JSON,
    Object,
    String,
    Number,
    Boolean,
    Array,
    Math,
    Error,
    Promise,
  };
  vm.runInNewContext(authSource, context, { filename: "platform-auth.js" });
  return window.WorklogPlatformAuth;
}

function seedSession(storage) {
  storage.setItem("worklogSupabasePublicConfigV1", JSON.stringify({
    savedAt: Date.now(),
    config: publicConfig,
  }));
  storage.setItem("worklogSupabaseSessionV1", JSON.stringify({
    access_token: "expired-access-token",
    refresh_token: "refresh-token-old",
  }));
}

test("concurrent session refresh callers share one Supabase refresh request", async () => {
  const storage = createStorage();
  seedSession(storage);
  let refreshCalls = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });

  const auth = loadAuth({
    localStorage: storage,
    fetchImpl: async (url) => {
      assert.equal(url, "https://project.supabase.co/auth/v1/token?grant_type=refresh_token");
      refreshCalls += 1;
      await refreshGate;
      return {
        ok: true,
        json: async () => ({ access_token: "fresh-access-token", refresh_token: "refresh-token-new" }),
      };
    },
  });

  const first = auth.refreshSession();
  const second = auth.refreshSession();
  await Promise.resolve();
  assert.equal(refreshCalls, 1, "refresh token must not be consumed by parallel callers");

  releaseRefresh();
  const [firstSession, secondSession] = await Promise.all([first, second]);
  assert.equal(firstSession.access_token, "fresh-access-token");
  assert.equal(secondSession.access_token, "fresh-access-token");
  assert.equal(auth.readSession().refresh_token, "refresh-token-new");
});

test("briefing GET refreshes a stale Platform session once and retries with new auth", () => {
  assert.match(briefingSource, /async function fetchV2\(\{ask=true,retryAuth=true\}=\{\}\)/);
  assert.match(briefingSource, /res\.status===401 && retryAuth && platformSession\?\.access_token/);
  assert.match(briefingSource, /await window\.WorklogPlatformAuth\.refreshSession\(\)/);
  assert.match(briefingSource, /return fetchV2\(\{ask:false,retryAuth:false\}\)/);
  assert.match(briefingSource, /res\.status===401 && !platformSession\?\.access_token/);
});

test("signed-in auth completion repairs an initial briefing race without an infinite loop", () => {
  assert.match(briefingSource, /worklog:platform-auth-changed/);
  assert.match(briefingSource, /platform-signed-in/);
  assert.match(briefingSource, /authRetryPending=true/);
  assert.match(briefingSource, /const retryAfterAuth=authRetryPending && lastLoadedAt===0/);
  assert.match(briefingSource, /window\.setTimeout\(\(\)=>refreshV2\(\{ask:false,silentFallback:true\}\),0\)/);
});

test("main app cache-busts the repaired auth and briefing clients", () => {
  assert.match(indexSource, /platform-auth\.js\?v=20260916-2/);
  assert.match(indexSource, /briefing-v2\.js\?v=20260916-3/);
});
