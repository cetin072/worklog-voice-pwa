import { runCustomerIndexDailySync } from "../netlify/shared/customer-index/daily-sync.mjs";
import {
  customerIndexDriveConfig,
  createGoogleDriveChangesAdapter,
} from "../netlify/shared/customer-index/google-drive-adapter.mjs";
import { createSupabaseCustomerIndexRepository } from "../netlify/shared/customer-index/supabase-live-index-adapter.mjs";
import { serverSupabaseAdminConfig } from "../netlify/shared/data-core/supabase-admin-config.mjs";
import { sanitizeErrorCode } from "../netlify/shared/customer-index/contracts.mjs";
import { pathToFileURL } from "node:url";

function env(name) {
  return String(process.env[name] || "").trim();
}

function enabled() {
  return env("CUSTOMER_INDEX_SYNC_ENABLED").toLowerCase() === "true";
}

export async function main() {
  if (!enabled()) {
    console.log("Customer Index Daily Sync skipped", JSON.stringify({ reason: "disabled" }));
    return Object.freeze({ status: "disabled" });
  }

  const workspaceId = env("CUSTOMER_INDEX_SYNC_WORKSPACE_ID");
  const driveConfig = customerIndexDriveConfig(env);
  const supabaseConfig = serverSupabaseAdminConfig(env);
  if (!workspaceId || !driveConfig.configured || !supabaseConfig.configured) {
    const error = new Error("Customer Index Daily Sync configuration is incomplete");
    error.code = "CUSTOMER_INDEX_SYNC_CONFIG_INCOMPLETE";
    throw error;
  }

  const drive = createGoogleDriveChangesAdapter({ config: driveConfig });
  const repository = createSupabaseCustomerIndexRepository({
    supabaseUrl: supabaseConfig.supabaseUrl,
    secretKey: supabaseConfig.secretKey,
    rootFolderId: driveConfig.watchFolderId,
  });
  const result = await runCustomerIndexDailySync({
    workspaceId,
    drive,
    repository,
    now: new Date(),
  });
  console.log("Customer Index Daily Sync complete", JSON.stringify({
    status: result.status,
    changed: result.changed,
    skipped: result.skipped,
    existingIdentity: result.existingIdentity,
    newIdentity: result.newIdentity,
    reviewRequired: result.reviewRequired,
    sourceUnavailable: result.sourceUnavailable,
  }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Customer Index Daily Sync failed", sanitizeErrorCode(error));
    process.exitCode = 1;
  });
}
