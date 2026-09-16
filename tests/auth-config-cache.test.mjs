import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/platform-auth.js", import.meta.url), "utf8");
const functionSource = readFileSync(new URL("../netlify/functions/supabase-auth-config.mts", import.meta.url), "utf8");

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
  vm.runInNewContext(source, context, { filename: "platform-auth.js" });
  return window.WorklogPlatformAuth;
}

const publicConfig = {
  configured: true,
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "sb_publishable_example",
  dataCorePrimaryEnabled: true,
};

test("fresh public auth config survives a page reload without another Function request", async () => {
  const storage = createStorage();
  let calls = 0;
  const first = loadAuth({
    localStorage: storage,
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url, "/api/supabase-auth-config");
      return { ok: true, json: async () => publicConfig };
    },
  });
  assert.equal((await first.getConfig()).supabaseUrl, publicConfig.supabaseUrl);
  assert.equal(calls, 1);

  const second = loadAuth({
    localStorage: storage,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("fresh cache must avoid network");
    },
  });
  assert.equal((await second.getConfig()).publishableKey, publicConfig.publishableKey);
  assert.equal(calls, 1);
});

test("slightly stale public config returns immediately while refresh continues in background", async () => {
  const storage = createStorage();
  storage.setItem("worklogSupabasePublicConfigV1", JSON.stringify({
    savedAt: Date.now() - 6 * 60 * 1000,
    config: publicConfig,
  }));
  let calls = 0;
  const auth = loadAuth({
    localStorage: storage,
    fetchImpl: () => {
      calls += 1;
      return new Promise(() => {});
    },
  });
  const config = await auth.getConfig();
  assert.equal(config.supabaseUrl, publicConfig.supabaseUrl);
  assert.equal(calls, 1, "stale cache should trigger one background refresh");
});

test("expired public config is not trusted past the stale window", async () => {
  const storage = createStorage();
  storage.setItem("worklogSupabasePublicConfigV1", JSON.stringify({
    savedAt: Date.now() - 25 * 60 * 60 * 1000,
    config: publicConfig,
  }));
  let calls = 0;
  const auth = loadAuth({
    localStorage: storage,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ ...publicConfig, dataCorePrimaryEnabled: false }) };
    },
  });
  assert.equal((await auth.getConfig()).dataCorePrimaryEnabled, false);
  assert.equal(calls, 1);
});

test("public auth config endpoint allows only short public caching", () => {
  assert.match(functionSource, /cache-control\": \"public, max-age=300, stale-while-revalidate=3600\"/);
  assert.doesNotMatch(functionSource, /cache-control\": \"no-store\"/);
  assert.match(source, /CONFIG_FRESH_MS = 5 \* 60 \* 1000/);
  assert.match(source, /CONFIG_STALE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /fetch\("\/api\/supabase-auth-config", \{ cache: \"default\" \}\)/);
});
