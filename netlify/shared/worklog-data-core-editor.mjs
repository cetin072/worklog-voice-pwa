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

function rpcUnavailable(error,name){
  if(error?.code!=="SUPABASE_DATA_CORE_RPC_FAILED") return false;
  const message=String(error?.message || "");
  return new RegExp(`(?:could not find|schema cache)[\\s\\S]*${name}|${name}[\\s\\S]*(?:could not find|schema cache)`,"i").test(message);
}

function translateRpcError(error){
  if(error?.code!=="SUPABASE_DATA_CORE_RPC_FAILED") return error;
  const message=String(error?.message || "");
  if(/AUTHENTICATION_REQUIRED/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_AUTH_REQUIRED","로그인 세션을 확인하지 못했습니다.");
  if(/PERSONAL_WORKSPACE_MISSING/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_WORKSPACE_MISSING","개인 업무공간을 찾지 못했습니다.");
  if(/WORK_RECORD_NOT_FOUND_OR_FORBIDDEN/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN","수정할 업무를 찾지 못했거나 수정 권한이 없습니다.");
  if(/WORK_RECORD_TITLE_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_TITLE_INVALID","업무명을 확인해주세요.");
  if(/WORK_RECORD_DUE_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_DUE_INVALID","날짜와 시간을 확인해주세요.");
  if(/WORK_RECORD_ACTION_KIND_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_ACTION_KIND_INVALID","업무 종류를 확인해주세요.");
  if(/WORK_RECORD_ACTION_CONVERSION_UNCLASSIFIED/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_ACTION_UNCLASSIFIED","분류되지 않은 기존 기록은 할 일/메모 전환 대상이 아닙니다.");
  if(/WORK_RECORD_ACTION_CONVERSION_SCHEDULE_LINKED/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_ACTION_SCHEDULE_LINKED","일정과 연결된 기록은 할 일/메모 종류를 바꿀 수 없습니다.");
  return error;
}

function singleRow(result){
  const rows=Array.isArray(result) ? result : result ? [result] : [];
  if(rows.length!==1) throw editError("WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN","수정할 업무를 찾지 못했거나 수정 권한이 없습니다.");
  return rows[0] || {};
}

export function createWorklogDataCoreEditor({client}={}){
  if(!client || typeof client.rpc!=="function") throw editError("WORKLOG_DATA_CORE_EDIT_CLIENT_REQUIRED","Data Core RPC client가 필요합니다.");

  return Object.freeze({
    async readDetails({recordId:rawRecordId}={}){
      const id=recordId(rawRecordId);
      try{
        let row;
        try{
          row=singleRow(await client.rpc("get_my_work_record_edit_v2",{p_record_id:id}));
          return Object.freeze({
            recordId:id,
            title:String(row.title_value || ""),
            dueAt:row.due_at_value ? String(row.due_at_value) : null,
            dueHasTime:row.due_has_time===true,
            actionKind:row.action_kind_value==="task" || row.action_kind_value==="note" ? String(row.action_kind_value) : null,
            actionConversionAllowed:row.action_conversion_allowed===true
          });
        }catch(error){
          if(!rpcUnavailable(error,"get_my_work_record_edit_v2")) throw error;
          row=singleRow(await client.rpc("get_my_work_record_edit",{p_record_id:id}));
          return Object.freeze({
            recordId:id,
            title:String(row.title_value || ""),
            dueAt:row.due_at_value ? String(row.due_at_value) : null,
            dueHasTime:row.due_has_time===true,
            actionKind:null,
            actionConversionAllowed:false
          });
        }
      }catch(error){
        throw translateRpcError(error);
      }
    },

    async updateDetails({recordId:rawRecordId,title:rawTitle,dueAt=null,dueHasTime=false,actionKind:rawActionKind=null}={}){
      const id=recordId(rawRecordId);
      const nextTitle=title(rawTitle);
      if(dueAt!==null && !Number.isFinite(new Date(String(dueAt)).getTime())) throw editError("WORKLOG_DATA_CORE_EDIT_DUE_INVALID","날짜와 시간을 확인해주세요.");
      if(dueAt===null && dueHasTime) throw editError("WORKLOG_DATA_CORE_EDIT_DUE_INVALID","시간을 설정하려면 날짜도 입력해주세요.");
      const nextActionKind=rawActionKind===null || rawActionKind===undefined || rawActionKind===""
        ? null
        : String(rawActionKind).trim().toLowerCase();
      if(nextActionKind!==null && nextActionKind!=="task" && nextActionKind!=="note"){
        throw editError("WORKLOG_DATA_CORE_EDIT_ACTION_KIND_INVALID","업무 종류를 확인해주세요.");
      }
      try{
        if(nextActionKind!==null){
          try{
            const row=singleRow(await client.rpc("update_my_work_record_details_v2",{
              p_record_id:id,
              p_title:nextTitle,
              p_due_at:dueAt===null ? null : String(dueAt),
              p_due_has_time:Boolean(dueAt!==null && dueHasTime),
              p_action_kind:nextActionKind
            }));
            return Object.freeze({
              recordId:id,
              title:String(row.title_value || nextTitle),
              dueAt:row.due_at_value ? String(row.due_at_value) : null,
              dueHasTime:row.due_has_time===true,
              actionKind:row.action_kind_value==="task" || row.action_kind_value==="note" ? String(row.action_kind_value) : nextActionKind,
              actionKindChanged:row.action_kind_changed===true,
              scheduleUpdated:row.schedule_updated===true
            });
          }catch(error){
            if(rpcUnavailable(error,"update_my_work_record_details_v2")){
              throw editError("WORKLOG_DATA_CORE_EDIT_ACTION_CONVERSION_UNAVAILABLE","업무 종류 변경 기능이 아직 준비되지 않았습니다.");
            }
            throw error;
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
          actionKind:null,
          actionKindChanged:false,
          scheduleUpdated:row.schedule_updated===true
        });
      }catch(error){
        throw translateRpcError(error);
      }
    }
  });
}
