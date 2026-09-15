import test from "node:test";
import assert from "node:assert/strict";

import {
  createUnconfiguredSharedCostAdmin,
  normalizeUserMonthlyCostRow,
  toSharedCostPoolRow,
} from "../netlify/shared/data-core/shared-cost.mjs";

test("shared cost pool input을 canonical DB row로 정규화한다", () => {
  const row = toSharedCostPoolRow({
    monthStart: "2026-09-01",
    costKey: "supabase-base",
    provider: "Supabase",
    category: "database",
    amountKrw: 35000,
    sourceNote: "Pro base plan",
    metadata: { source: "invoice" },
  });

  assert.deepEqual(row, {
    month_start: "2026-09-01",
    cost_key: "supabase-base",
    provider: "supabase",
    category: "database",
    amount_krw: 35000,
    allocation_method: "equal_active_user",
    source_note: "Pro base plan",
    metadata: { source: "invoice" },
  });
});

test("월 시작일, category, 음수 비용은 fail-closed 한다", () => {
  assert.throws(
    () => toSharedCostPoolRow({ monthStart: "2026-09-15", costKey: "x", provider: "x", category: "database", amountKrw: 1 }),
    (error) => error?.code === "SHARED_COST_MONTH_START_INVALID",
  );
  assert.throws(
    () => toSharedCostPoolRow({ monthStart: "2026-09-01", costKey: "x", provider: "x", category: "unknown", amountKrw: 1 }),
    (error) => error?.code === "SHARED_COST_CATEGORY_INVALID",
  );
  assert.throws(
    () => toSharedCostPoolRow({ monthStart: "2026-09-01", costKey: "x", provider: "x", category: "database", amountKrw: -1 }),
    (error) => error?.code === "SHARED_COST_AMOUNT_KRW_INVALID",
  );
});

test("user_monthly_cost row에서 direct/shared/total을 분리해서 읽는다", () => {
  const row = normalizeUserMonthlyCostRow({
    month_start: "2026-09-01",
    user_id: "user_1",
    workspace_id: "workspace_1",
    direct_cost_krw: "440",
    allocated_shared_cost_krw: "180",
    total_cost_krw: "620",
  });

  assert.equal(row.directCostKrw, 440);
  assert.equal(row.allocatedSharedCostKrw, 180);
  assert.equal(row.totalCostKrw, 620);
});

test("trusted shared-cost admin 미연결 상태는 성공 처리하지 않는다", async () => {
  const admin = createUnconfiguredSharedCostAdmin();
  assert.equal(admin.configured, false);
  await assert.rejects(
    () => admin.upsertPool({}),
    (error) => error?.code === "SHARED_COST_ADMIN_NOT_CONFIGURED",
  );
  await assert.rejects(
    () => admin.recalculateMonth("2026-09-01"),
    (error) => error?.code === "SHARED_COST_ADMIN_NOT_CONFIGURED",
  );
});
