import { toSharedCostPoolRow } from "./shared-cost.mjs";
import { toUsageEventRow } from "./usage-ledger.mjs";

function writerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createTrustedUsageWriter(client) {
  if (!client || typeof client.insertUsageEventIdempotent !== "function") {
    throw writerError("TRUSTED_USAGE_CLIENT_REQUIRED", "Trusted Usage admin client가 필요합니다.");
  }

  return Object.freeze({
    configured: true,
    async record(raw, context = {}) {
      const row = toUsageEventRow(raw, context);
      return client.insertUsageEventIdempotent(row);
    },
  });
}

export function createTrustedSharedCostAdmin(client) {
  if (!client
      || typeof client.upsertSharedCostPool !== "function"
      || typeof client.recalculateSharedCostAllocations !== "function") {
    throw writerError("TRUSTED_SHARED_COST_CLIENT_REQUIRED", "Trusted Shared Cost admin client가 필요합니다.");
  }

  return Object.freeze({
    configured: true,
    async upsertPool(input) {
      return client.upsertSharedCostPool(toSharedCostPoolRow(input));
    },
    async recalculateMonth(monthStart) {
      return client.recalculateSharedCostAllocations(monthStart);
    },
  });
}
