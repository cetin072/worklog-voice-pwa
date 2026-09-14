import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/platform-auth.js", import.meta.url), "utf8");

function createHarness(session = null) {
  const values = new Map();
  if (session) values.set("worklogSupabaseSessionV1", JSON.stringify(session));
  const calls = [];
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const nativeFetch = async (input, init = {}) => {
    calls.push({ input, init });
    return { ok: true, json: async () => ({}) };
  };
  const window = {
    fetch: nativeFetch,
    location: new URL("https://worklog.example.test/app"),
  };
  const context = vm.createContext({
    window,
    localStorage,
    Request,
    Headers,
    URL,
    console,
  });
  vm.runInContext(source, context, { filename: "platform-auth.js" });
  return { window, calls, values };
}

function header(call, name) {
  return new Headers(call.init?.headers || undefined).get(name);
}

test("Platform Auth attaches the current bearer token only to same-origin /api/worklog", async () => {
  const { window, calls } = createHarness({ access_token: "user-access-token" });

  await window.fetch("/api/worklog", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  assert.equal(header(calls[0], "authorization"), "Bearer user-access-token");
  assert.equal(header(calls[0], "content-type"), "application/json");

  await window.fetch("https://other.example.test/api/worklog", { method: "POST" });
  assert.equal(header(calls[1], "authorization"), null);

  await window.fetch("/api/supabase-auth-config", { cache: "no-store" });
  assert.equal(header(calls[2], "authorization"), null);
});

test("Platform Auth does not attach a bearer token when there is no session", async () => {
  const { window, calls } = createHarness();
  await window.fetch("/api/worklog", { method: "POST" });
  assert.equal(header(calls[0], "authorization"), null);
});
