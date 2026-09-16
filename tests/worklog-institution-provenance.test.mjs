import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../netlify/functions/worklog.mts", import.meta.url), "utf8");

test("worklog API only forwards trusted institution provenance to Data Core record", () => {
  assert.match(source, /TRUSTED_INSTITUTION_SOURCES = new Set\(\["user_selected","user_confirmed"\]\)/);
  assert.match(source, /requestedInstitutionSource=String\(body\.institutionSource \|\| body\.institution_source \|\| ""\)/);
  assert.match(source, /TRUSTED_INSTITUTION_SOURCES\.has\(requestedInstitutionSource\) \? requestedInstitutionSource : "unverified"/);
  assert.match(source, /cleanTranscript, institution, institutionSource, status, type/);
});
