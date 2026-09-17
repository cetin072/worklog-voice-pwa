import type { Config } from "@netlify/functions";
import { runCustomerIndexDailySync } from "../shared/customer-index/daily-sync.mjs";
import {
  customerIndexDriveConfig,
  createGoogleDriveChangesAdapter,
} from "../shared/customer-index/google-drive-adapter.mjs";
import { createSupabaseCustomerIndexRepository } from "../shared/customer-index/supabase-live-index-adapter.mjs";
import { serverSupabaseAdminConfig } from "../shared/data-core/supabase-admin-config.mjs";
import { sanitizeErrorCode } from "../shared/customer-index/contracts.mjs";

function env(name:string){
  return String(Netlify.env.get(name) || "").trim();
}

function enabled(){
  return env("CUSTOMER_INDEX_SYNC_ENABLED").toLowerCase() === "true";
}

export default async ()=>{
  if(!enabled()){
    console.log("Customer Index Daily Sync skipped",JSON.stringify({reason:"disabled"}));
    return;
  }

  const workspaceId=env("CUSTOMER_INDEX_SYNC_WORKSPACE_ID");
  const driveConfig=customerIndexDriveConfig(env);
  const supabaseConfig=serverSupabaseAdminConfig(env);
  if(!workspaceId || !driveConfig.configured || !supabaseConfig.configured){
    const error:any=new Error("Customer Index Daily Sync configuration is incomplete");
    error.code="CUSTOMER_INDEX_SYNC_CONFIG_INCOMPLETE";
    console.error("Customer Index Daily Sync failed",error.code);
    throw error;
  }

  const drive=createGoogleDriveChangesAdapter({config:driveConfig});
  const repository=createSupabaseCustomerIndexRepository({
    supabaseUrl:supabaseConfig.supabaseUrl,
    secretKey:supabaseConfig.secretKey,
    rootFolderId:driveConfig.watchFolderId,
  });

  try{
    const result=await runCustomerIndexDailySync({
      workspaceId,
      drive,
      repository,
      now:new Date(),
    });
    console.log("Customer Index Daily Sync complete",JSON.stringify({
      status:result.status,
      changed:result.changed,
      skipped:result.skipped,
      existingIdentity:result.existingIdentity,
      newIdentity:result.newIdentity,
      reviewRequired:result.reviewRequired,
      sourceUnavailable:result.sourceUnavailable,
    }));
  }catch(error:any){
    console.error("Customer Index Daily Sync failed",sanitizeErrorCode(error));
    throw error;
  }
};

// Netlify cron is UTC. 00:15 UTC = 09:15 Asia/Seoul.
export const config:Config={schedule:"15 0 * * *"};
