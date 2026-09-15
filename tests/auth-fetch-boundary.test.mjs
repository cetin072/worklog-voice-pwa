import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/auth.js", import.meta.url), "utf8");

function harness() {
  const values = new Map();
  const calls = [];
  const localStorage = {
    getItem: key => values.get(key) || null,
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
    WorklogPlatformAuth: { readSession: () => ({ access_token: "platform-user-token" }) },
  };
  const context = vm.createContext({
    window,
    localStorage,
    Request,
    Headers,
    URL,
    document: { getElementById: () => null },
    prompt: () => "",
    location: window.location,
    console,
  });
  vm.runInContext(source, context, { filename: "auth.js" });
  return { window, calls };
}

function header(call, name) {
  return new Headers(call.init?.headers || undefined).get(name);
}

test("worklog auth attaches Platform bearer only to same-origin worklog and briefing-v2 APIs", async () => {
  const { window, calls } = harness();

  await window.fetch("/api/worklog", { method: "POST" });
  assert.equal(header(calls[0], "authorization"), "Bearer platform-user-token");

  await window.fetch("/api/briefing-v2", { method: "GET" });
  assert.equal(header(calls[1], "authorization"), "Bearer platform-user-token");

  await window.fetch("https://external.example.test/api/worklog", { method: "POST" });
  assert.equal(header(calls[2], "authorization"), null);

  await window.fetch("https://external.example.test/api/briefing-v2", { method: "GET" });
  assert.equal(header(calls[3], "authorization"), null);
});
