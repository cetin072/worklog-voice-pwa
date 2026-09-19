import { normalizeWorklogTitle, validWorklogPageId } from "./worklog-edit.mjs";

function editError(code,message){
  const error=new Error(message);
  error.code=code;
  return error;
}

function recordId(value){
  const id=String(value || "").trim();
  if(!validWorklogPageId(id)) throw editError("WORKLOG_DATA_CORE_EDIT_RECORD_ID_INVALID","수정할 업무 식별자가 올바르지 않습니다.");
  return id;
}

function title(value){
  const normalized=normalizeWorklogTitle(value);
  if(!normalized) throw editError("WORKLOG_DATA_CORE_EDIT_TITLE_INVALID","업무명을 입력해주세요.");
  if(normalized.length>160) throw editError("WORKLOG_DATA_CORE_EDIT_TITLE_INVALID","업무명은 160자 이하로 입력해주세요.");
  return normalized;
}

function actionKind(value){
  if(value===undefined || value===null || value==="") return null;
  const normalized=String(value).trim().toLowerCase();
  if(normalized!=="task" && normalized!=="note"){
    throw editError("WORKLOG_DATA_CORE_EDIT_ACTION_INVALID","업무 종류를 확인해주세요.");
  }
  return normalized;
}

function rpcUnavailable(error,functionName){
  if(error?.code!=="SUPABASE_DATA_CORE_RPC_FAILED") return false;
  const message=String(error?.message || "");
  return message.includes(functionName) && /could not find|schema cache|function/i.test(message);
}

function translateRpcError(error){
  if(error?.code!=="SUPABASE_DATA_CORE_RPC_FAILED") return error;
  const message=String(error?.message || "");
  if(/AUTHENTICATION_REQUIRED/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_AUTH_REQUIRED","로그인 세션을 확인하지 못했습니다.");
  if(/PERSONAL_WORKSPACE_MISSING/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_WORKSPACE_MISSING","개인 업무공간을 찾지 못했습니다.");
  if(/WORK_RECORD_NOT_FOUND_OR_FORBIDDEN/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN","수정할 업무를 찾지 못했거나 수정 권한이 없습니다.");
  if(/WORK_RECORD_TITLE_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_TITLE_INVALID","업무명을 확인해주세요.");
  if(/WORK_RECORD_DUE_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_DUE_INVALID","날짜와 시간을 확인해주세요.");
  if(/WORK_RECORD_ACTION_KIND_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_ACTION_INVALID","업무 종류를 확인해주세요.");
  if(/WORK_RECORD_ACTION_CONVERSION_FORBIDDEN/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_ACTION_FORBIDDEN","일정과 연결된 기록은 할 일/메모로 전환할 수 없습니다.");
  return error;
}

function singleRow(result){
  const rows=Array.isArray(result) ? result : result ? [result] : [];
  if(rows.length!==1) throw editError("WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN","수정할 업무를 찾지 못했거나 수정 권한이 없습니다.");
  return rows[0] || {};
}

function normalizedReadResult(id,row,{v2=false}={}){
  const rawKind=String(row.action_kind_value || "").trim();
  return Object.freeze({
    recordId:id,
    title:String(row.title_value || ""),
    dueAt:row.due_at_value ? String(row.due_at_value) : null,
    dueHasTime:row.due_has_time===true,
    actionKind:rawKind==="task" || rawKind==="note" ? rawKind : null,
    actionConversionAllowed:v2 && row.action_conversion_allowed===true,
  });
}

export function createWorklogDataCoreEditor({client}={}){
  if(!client || typeof client.rpc!=="function") throw editError("WORKLOG_DATA_CORE_EDIT_CLIENT_REQUIRED","Data Core RPC client가 필요합니다.");

  return Object.freeze({
    async readDetails({recordId:rawRecordId}={}){
      const id=recordId(rawRecordId);
      try{
        try{
          const row=singleRow(await client.rpc("get_my_work_record_edit_v2",{p_record_id:id}));
          return normalizedReadResult(id,row,{v2:true});
        }catch(error){
          if(!rpcUnavailable(error,"get_my_work_record_edit_v2")) throw error;
        }

        const row=singleRow(await client.rpc("get_my_work_record_edit",{p_record_id:id}));
        return normalizedReadResult(id,row,{v2:false});
      }catch(error){
        throw translateRpcError(error);
      }
    },

    async updateDetails({
      recordId:rawRecordId,
      title:rawTitle,
      dueAt=null,
      dueHasTime=false,
      actionKind:rawActionKind=null,
    }={}){
      const id=recordId(rawRecordId);
      const nextTitle=title(rawTitle);
      const nextActionKind=actionKind(rawActionKind);
      if(dueAt!==null && !Number.isFinite(new Date(String(dueAt)).getTime())) throw editError("WORKLOG_DATA_CORE_EDIT_DUE_INVALID","날짜와 시간을 확인해주세요.");
      if(dueAt===null && dueHasTime) throw editError("WORKLOG_DATA_CORE_EDIT_DUE_INVALID","시간을 설정하려면 날짜도 입력해주세요.");

      const v2Body={
        p_record_id:id,
        p_title:nextTitle,
        p_due_at:dueAt===null ? null : String(dueAt),
        p_due_has_time:Boolean(dueAt!==null && dueHasTime),
        p_action_kind:nextActionKind,
      };

      try{
        try{
          const row=singleRow(await client.rpc("update_my_work_record_details_v2",v2Body));
          const rawKind=String(row.action_kind_value || "").trim();
          return Object.freeze({
            recordId:id,
            title:String(row.title_value || nextTitle),
            dueAt:row.due_at_value ? String(row.due_at_value) : null,
            dueHasTime:row.due_has_time===true,
            scheduleUpdated:row.schedule_updated===true,
            actionKind:rawKind==="task" || rawKind==="note" ? rawKind : null,
            actionChanged:row.action_changed===true,
            actionConversionAllowed:row.action_conversion_allowed===true,
          });
        }catch(error){
          if(!rpcUnavailable(error,"update_my_work_record_details_v2")) throw error;
          if(nextActionKind!==null){
            throw editError("WORKLOG_DATA_CORE_EDIT_ACTION_UNAVAILABLE","업무 종류 전환 기능을 준비하고 있습니다. 잠시 후 다시 시도해주세요.");
          }
        }

        const row=singleRow(await client.rpc("update_my_work_record_details",{
          p_record_id:id,
          p_title:nextTitle,
          p_due_at:dueAt===null ? null : String(dueAt),
          p_due_has_time:Boolean(dueAt!==null && dueHasTime)
        }));
        return Object.freeze({
          recordId:id,
          title:String(row.title_value || nextTitle),
          dueAt:row.due_at_value ? String(row.due_at_value) : null,
          dueHasTime:row.due_has_time===true,
          scheduleUpdated:row.schedule_updated===true,
          actionKind:null,
          actionChanged:false,
          actionConversionAllowed:false,
        });
      }catch(error){
        throw translateRpcError(error);
      }
    }
  });
}
