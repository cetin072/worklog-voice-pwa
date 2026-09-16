import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkRecord } from "../netlify/shared/record-normalization.mjs";

function record(overrides = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    title: "노무사 자료 정리",
    content: "노무사 자료 정리해야 함",
    original_text: "노무사 자료 정리해야 함",
    institution: "태장",
    status: "in_progress",
    record_type: "task",
    metadata: {},
    ...overrides,
  };
}

test("legacy Notion institution is retained only as unverified structured metadata", () => {
  const result = normalizeWorkRecord(record({
    metadata: { legacy_source: "notion", migration: "legacy-notion-2026-09-15" },
  }));
  assert.equal(result.structuredData.institution, "태장");
  assert.equal(result.structuredData.provenance.institution, "legacy_unverified");
  assert.equal(result.structuredData.provenance.searchAliases, "unset");
  assert.equal(result.searchAliases.includes("태장"), false);
  assert.equal(result.reviewState, "unreviewed");
});

test("user-confirmed institution keeps trusted provenance and search alias", () => {
  const result = normalizeWorkRecord(record({
    metadata: { fieldProvenance: { institution: "user_confirmed" } },
  }));
  assert.equal(result.structuredData.institution, "태장");
  assert.equal(result.structuredData.provenance.institution, "user_confirmed");
  assert.equal(result.structuredData.provenance.searchAliases, "user_confirmed");
  assert.equal(result.searchAliases.includes("태장"), true);
  assert.equal(result.reviewState, "unreviewed");
});

test("automatic dictionary replacement is marked derived rather than user-confirmed", () => {
  const result = normalizeWorkRecord(record({
    institution: null,
    title: "사면 견적",
    content: "사면 견적 확인",
    original_text: "사면 견적 확인",
  }), {
    dictionary: [{
      entityType: "institution",
      canonical: "삼현",
      aliases: ["삼현", "사면"],
      confidence: 0.99,
      autoReplace: true,
      requiresReview: false,
    }],
  });
  assert.equal(result.structuredData.institution, "삼현");
  assert.equal(result.structuredData.provenance.institution, "auto_derived");
  assert.equal(result.structuredData.provenance.searchAliases, "auto_derived");
  assert.ok(result.searchAliases.includes("삼현"));
  assert.ok(result.searchAliases.includes("사면"));
});
