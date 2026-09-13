import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sqlUrl = new URL("../docs/sql/call-processing-foundation-v1.sql", import.meta.url);

async function sql() {
  return readFile(sqlUrl, "utf8");
}

test("calls 초안은 분석 V2 보고서를 JSON으로 보존한다", async () => {
  const text = await sql();
  assert.match(text, /analysis_version text not null default 'v2'/);
  assert.match(text, /report jsonb not null default/);
  for (const key of ["headline", "overview", "discussionPoints", "counterpartRequests", "userCommitments", "decisions", "openQuestions"]) {
    assert.equal(text.includes(key), true, `${key} 보고서 키가 SQL 초안에 있어야 한다`);
  }
});

test("통화 실행항목과 모든 유료 서비스 사용량은 별도 원장으로 연결된다", async () => {
  const text = await sql();
  assert.match(text, /create table if not exists public\.call_actions/);
  assert.match(text, /create table if not exists public\.usage_events/);
  assert.match(text, /audio_seconds/);
  assert.match(text, /input_tokens/);
  assert.match(text, /output_tokens/);
  assert.match(text, /estimated_cost_krw/);
  assert.match(text, /actual_cost_krw/);
  assert.match(text, /related_id uuid/);
});

test("원본 음성을 영구 저장하는 calls 컬럼은 만들지 않는다", async () => {
  const text = await sql();
  assert.equal(/\baudio_blob\b|\baudio_bytes\b|\baudio_file\b/i.test(text), false);
  assert.match(text, /temp_object_path text/);
  assert.match(text, /temp_expires_at timestamptz/);
});
