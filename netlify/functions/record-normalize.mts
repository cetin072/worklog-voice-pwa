import type { Config, Context } from "@netlify/functions";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";
import {
  createRecordNormalizationPlatformJob,
  createRecordNormalizationRetryPlan,
  runRecordNormalizationProcessing,
} from "../shared/record-normalization-processing.mjs";
import {
  dictionaryFromWorkspaceMetadata,
  normalizeWorkRecord,
  RECORD_NORMALIZATION_VERSION,
} from "../shared/record-normalization.mjs";

function bearerToken(req:Request){
  const match=/^Bearer\s+(.+)$/i.exec(String(req.headers.get("authorization") || ""));
  return match ? match[1].trim() : "";
}

function workRecordId(value:unknown){
  const id=String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function object(value:any){
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function processingStatus(job:any){
  if(job?.status === "completed"){
    return job?.checkpoints?.normalized?.reviewState === "needs_review" ? "needs_review" : "completed";
  }
  if(job?.status === "processing") return "processing";
  if(job?.status === "failed" || job?.status === "cancelled") return "failed";
  return "pending";
}

async function selectOne(client:any,table:string,query:Record<string,string>){
  const rows=await client.select(table,{...query,limit:"1"});
  return rows[0] || null;
}

export default async (req:Request,_context:Context)=>{
  if(req.method !== "POST") return;
  const accessToken=bearerToken(req);
  if(!accessToken) throw new Error("RECORD_NORMALIZATION_AUTH_REQUIRED");

  let body:any={};
  try{ body=await req.json(); }
  catch{ throw new Error("RECORD_NORMALIZATION_REQUEST_INVALID"); }
  const targetId=workRecordId(body.workRecordId);
  if(!targetId) throw new Error("RECORD_NORMALIZATION_RECORD_ID_INVALID");

  const supabaseUrl=Netlify.env.get("SUPABASE_URL");
  const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  if(!supabaseUrl || !publishableKey) throw new Error("RECORD_NORMALIZATION_SUPABASE_CONFIG_REQUIRED");

  const client=createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken});
  const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey});
  const workspaceContext=await resolver.resolve(accessToken);

  const record=await selectOne(client,"work_records",{
    select:"id,workspace_id,created_by_user_id,client_request_id,title,content,original_text,record_type,status,institution,follow_up,due_at,metadata",
    id:`eq.${targetId}`,
    workspace_id:`eq.${workspaceContext.workspaceId}`,
    created_by_user_id:`eq.${workspaceContext.userId}`,
  });
  if(!record) throw new Error("RECORD_NORMALIZATION_RECORD_NOT_FOUND");

  let normalization=await selectOne(client,"work_record_normalizations",{
    select:"work_record_id,workspace_id,created_by_user_id,processing_status,normalization_version,platform_job,retry_plan,attempt_count",
    work_record_id:`eq.${targetId}`,
    workspace_id:`eq.${workspaceContext.workspaceId}`,
  });

  if(!normalization){
    normalization=await client.upsert("work_record_normalizations",{
      work_record_id:targetId,
      workspace_id:workspaceContext.workspaceId,
      created_by_user_id:workspaceContext.userId,
      processing_status:"pending",
      source_quality:String(record.original_text || "").trim() ? "original" : "fallback_content",
    },["work_record_id"]);
  }

  if(
    (normalization.processing_status === "completed" || normalization.processing_status === "needs_review")
    && normalization.normalization_version === RECORD_NORMALIZATION_VERSION
  ) return;

  const workspace=await selectOne(client,"workspaces",{
    select:"id,metadata",
    id:`eq.${workspaceContext.workspaceId}`,
  });
  const workspaceMetadata=object(workspace?.metadata);
  const requestId=/^[A-Za-z0-9-]{16,100}$/.test(String(record.client_request_id || ""))
    ? String(record.client_request_id)
    : `norm-${targetId}`;
  const existingJob=object(normalization.platform_job);
  const job=createRecordNormalizationPlatformJob({
    existingJob:existingJob.jobId ? existingJob : null,
    requestId,
    workRecordId:targetId,
    workspaceContext,
  });

  const saveJob=async(nextJob:any)=>{
    const row:any={
      platform_job:nextJob,
      processing_status:processingStatus(nextJob),
      attempt_count:Number(nextJob.attemptCount || 0),
      last_error_code:String(nextJob.errorCode || "") || null,
      last_error_message:String(nextJob.errorMessage || "") || null,
    };
    if(nextJob.status === "completed"){
      row.next_retry_at=null;
      row.retry_plan={};
    }
    await client.update("work_record_normalizations",row,{
      work_record_id:`eq.${targetId}`,
      workspace_id:`eq.${workspaceContext.workspaceId}`,
    });
  };

  const result=await runRecordNormalizationProcessing({
    job,
    requestId,
    workRecordId:targetId,
    workspaceContext,
    payload:{record},
    handlers:{
      normalizing:async()=>({
        checkpoint:normalizeWorkRecord(record,{
          dictionary:dictionaryFromWorkspaceMetadata(workspaceMetadata),
        }),
      }),
      persisting:async({checkpoints}:any)=>{
        const normalized=checkpoints.normalized;
        if(!normalized) throw new Error("RECORD_NORMALIZATION_CHECKPOINT_MISSING");
        await client.update("work_record_normalizations",{
          normalized_title:normalized.normalizedTitle,
          normalized_text:normalized.normalizedText,
          structured_data:normalized.structuredData,
          search_aliases:normalized.searchAliases,
          confidence:normalized.confidence,
          review_state:normalized.reviewState,
          normalization_version:normalized.version,
          source_quality:normalized.sourceQuality,
          normalized_at:new Date().toISOString(),
          last_error_code:null,
          last_error_message:null,
        },{
          work_record_id:`eq.${targetId}`,
          workspace_id:`eq.${workspaceContext.workspaceId}`,
        });
        return {checkpoint:{version:normalized.version}};
      },
    },
  },{saveJob});

  if(result.ok) return;

  const plan=createRecordNormalizationRetryPlan(result.job,new Date());
  await client.update("work_record_normalizations",{
    processing_status:plan.status === "scheduled" ? "failed" : "failed",
    retry_plan:plan,
    next_retry_at:plan.retryAt,
    last_error_code:result.error?.code || null,
    last_error_message:result.error?.message || null,
  },{
    work_record_id:`eq.${targetId}`,
    workspace_id:`eq.${workspaceContext.workspaceId}`,
  });

  if(plan.status === "scheduled"){
    const retryError:any=new Error(result.error?.message || "기록 정제 재시도가 필요합니다.");
    retryError.code=result.error?.code || "RECORD_NORMALIZATION_RETRY";
    throw retryError;
  }
};

export const config:Config={
  path:"/api/record-normalize",
  method:["POST"],
  background:true,
};
