import assert from "node:assert/strict";
import test from "node:test";
import { createNotionWorklogAdapter, makeNotionWorklogTitle, toNotionWorklogPagePayload } from "../netlify/shared/notion-worklog-adapter.mjs";

const record = {
  transcript: "원문", cleanTranscript: "계약서 확인", institution: "태장", status: "진행중", type: "할 일",
  recordedDate: "2026-09-14", amount: 12000, assignee: "김대리", followUp: "오후 연락", dueStart: "2026-09-15",
};

test("Notion Worklog adapter payload는 기존 Data Source와 업무 속성을 유지한다", () => {
  const payload = toNotionWorklogPagePayload(record, "data-source-1");
  assert.equal(payload.parent.data_source_id, "data-source-1");
  assert.equal(payload.properties["업무명"].title[0].text.content, "계약서 확인");
  assert.equal(payload.properties["기관"].select.name, "태장");
  assert.equal(payload.properties["기록일"].date.start, "2026-09-14");
  assert.equal(payload.properties["기한"].date.start, "2026-09-15");
  assert.equal(payload.properties["금액"].number, 12000);
  assert.equal(makeNotionWorklogTitle("x ".repeat(40)).length, 58);
});

test("Notion Worklog adapter는 page 생성 결과를 정규화하고 오류를 숨기지 않는다", async () => {
  const calls = [];
  const adapter = createNotionWorklogAdapter({
    token: "token", dataSourceId: "data-source-1", notionVersion: "2026-03-11",
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: "page-1", url: "https://notion.so/page-1" }) }; },
  });
  assert.deepEqual(await adapter.create(record), { pageId: "page-1", url: "https://notion.so/page-1" });
  assert.equal(calls[0].url, "https://api.notion.com/v1/pages");
  assert.equal(calls[0].init.headers["Notion-Version"], "2026-03-11");
  const failing = createNotionWorklogAdapter({ token: "token", dataSourceId: "data", notionVersion: "2026-03-11", fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ code: "restricted_resource" }) }) });
  await assert.rejects(() => failing.create(record), (error) => error?.code === "NOTION_WORKLOG_WRITE_FAILED" && error?.notionStatus === 403);
});
