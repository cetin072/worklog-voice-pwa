import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorklogTitle, validWorklogPageId } from "../netlify/shared/worklog-edit.mjs";

test("normalizeWorklogTitle trims and collapses whitespace",()=>{
  assert.equal(normalizeWorklogTitle("  범한매카텍   견적\n확인  "),"범한매카텍 견적 확인");
});

test("validWorklogPageId accepts Notion UUID forms",()=>{
  assert.equal(validWorklogPageId("12345678-1234-1234-1234-1234567890ab"),true);
  assert.equal(validWorklogPageId("123456781234123412341234567890ab"),true);
  assert.equal(validWorklogPageId("demo"),false);
});
