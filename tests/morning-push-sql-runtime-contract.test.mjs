import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fix = readFileSync(new URL("../supabase/migrations/20260916142500_fix_notification_claim_conflict_target.sql", import.meta.url), "utf8");

test("morning claim qualifies output-like count columns and uses the named dedupe constraint", () => {
  assert.match(fix, /select c\.\* from candidates c/);
  assert.match(fix, /where c\.today_count \+ c\.overdue_count \+ c\.schedule_count > 0/);
  assert.match(fix, /on conflict on constraint notification_deliveries_subscription_id_kind_local_date_key do nothing/);
  assert.match(fix, /returning nd\.id, nd\.subscription_id/);
  assert.doesNotMatch(fix, /where today_count \+ overdue_count \+ schedule_count > 0/);
  assert.doesNotMatch(fix, /on conflict \(subscription_id, kind, local_date\)/);
});
