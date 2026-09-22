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
  if(String(error?.remoteCode || "")==="PGRST202") return true;
  const message=String(error?.message || "");
  return new RegExp(`(?:could not find|schema cache)[\\s\\S]*${name}|${name}[\\s\\S]*(?:could not find|schema cache)`,"i").test(message);
}

function translateRpcError(error){
  if(error?.code==="SUPABASE_DATA_CORE_NETWORK_FAILED"){
    return editError("WORKLOG_DATA_CORE_EDIT_NETWORK_FAILED","업무 서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해주세요.");
  }
  if(error?.code!=="SUPABASE_DATA_CORE_RPC_FAILED") return error;
  const message=String(error?.message || "");
  const remoteCode=String(error?.remoteCode || "");
  if(["PGRST301","PGRST303"].includes(remoteCode) || /(?:JWT|token)[\\s\\S]*(?:expired|invalid)|(?:expired|invalid)[\\s\\S]*(?:JWT|token)/i.test(message)){
    return editError("WORKLOG_DATA_CORE_EDIT_AUTH_REQUIRED","로그인 세션이 만료되었습니다. 다시 로그인해주세요.");
  }
  if(remoteCode==="42501" || /permission denied/i.test(message)){
    return editError("WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN","수정할 업무를 찾지 못했거나 수정 권한이 없습니다.");
  }
  if(remoteCode==="PGRST202"){
    return editError("WORKLOG_DATA_CORE_EDIT_RPC_UNAVAILABLE","업무 수정 기능 연결이 아직 갱신되지 않았습니다. 잠시 후 다시 시도해주세요.");
  }
  if(/AUTHENTICATION_REQUIRED/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_AUTH_REQUIRED","로그인 세션을 확인하지 못했습니다.");
  if(/PERSONAL_WORKSPACE_MISSING/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_WORKSPACE_MISSING","개인 업무공간을 찾지 못했습니다.");
  if(/WORK_RECORD_NOT_FOUND_OR_FORBIDDEN/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN","업무를 찾지 못했거나 변경 권한이 없습니다.");
  if(/WORK_RECORD_TITLE_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_TITLE_INVALID","업무명을 확인해주세요.");
  if(/WORK_RECORD_DUE_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_DUE_INVALID","날짜와 시간을 확인해주세요.");
  if(/WORK_RECORD_ACTION_KIND_INVALID/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_ACTION_KIND_INVALID","업무 종류를 확인해주세요.");
  if(/WORK_RECORD_ACTION_CONVERSION_UNCLASSIFIED/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_ACTION_UNCLASSIFIED","분류되지 않은 기존 기록은 할 일/메모 전환 대상이 아닙니다.");
  if(/WORK_RECORD_ACTION_CONVERSION_SCHEDULE_LINKED/i.test(message)) return editError("WORKLOG_DATA_CORE_EDIT_ACTION_SCHEDULE_LINKED","일정과 연결된 기록은 할 일/메모 종류를 바꿀 수 없습니다.");
  if(/WORK_RECORD_POSTPONE_DUE_REQUIRED/i.test(message)) return editError("WORKLOG_DATA_CORE_POSTPONE_DUE_REQUIRED","미룰 날짜를 선택해주세요.");
  if(/WORK_RECORD_POSTPONE_SCHEDULE_LINKED/i.test(message)) return editError("WORKLOG_DATA_CORE_POSTPONE_SCHEDULE_LINKED","일정과 연결된 업무는 일정 화면에서 시간을 변경해주세요.");
  if(/WORK_RECORD_POSTPONE_UNDO_UNAVAILABLE/i.test(message)) return editError("WORKLOG_DATA_CORE_POSTPONE_UNDO_UNAVAILABLE","되돌릴 미루기 기록이 없습니다.");
  if(/WORK_RECORD_POSTPONE_UNDO_STALE/i.test(message)) return editError("WORKLOG_DATA_CORE_POSTPONE_UNDO_STALE","업무 기한이 이미 다시 변경되어 이전 미루기를 되돌리지 않았습니다.");
  if(/WORK_RECORD_ATTENTION_UNDO_STALE/i.test(message)) return editError("WORKLOG_DATA_CORE_ATTENTION_UNDO_STALE","다시 알림이 이미 다시 변경되어 이전 상태를 덮어쓰지 않았습니다.");
  if(/WORK_RECORD_ATTENTION_MUST_BE_FUTURE/i.test(message)) return editError("WORKLOG_DATA_CORE_ATTENTION_MUST_BE_FUTURE","다시 확인할 시간은 지금 이후로 선택해주세요.");
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
    },

    async deleteRecord({recordId:rawRecordId}={}){
      const id=recordId(rawRecordId);
      try{
        const row=singleRow(await client.rpc("cancel_my_work_record",{p_record_id:id}));
        const scheduleIds=Array.isArray(row.cancelled_schedule_ids)
          ? row.cancelled_schedule_ids.map((value)=>String(value || "").trim()).filter(Boolean)
          : [];
        return Object.freeze({
          recordId:id,
          status:String(row.status_value || "cancelled"),
          alreadyDeleted:row.already_cancelled===true,
          cancelledScheduleIds:Object.freeze(scheduleIds)
        });
      }catch(error){ throw translateRpcError(error); }
    },

    async postpone({recordId:rawRecordId,dueAt,dueHasTime=false}={}){
      const id=recordId(rawRecordId);
      if(!dueAt || !Number.isFinite(new Date(String(dueAt)).getTime())) throw editError("WORKLOG_DATA_CORE_POSTPONE_DUE_REQUIRED","미룰 날짜를 선택해주세요.");
      try{
        const row=singleRow(await client.rpc("postpone_my_work_record",{
          p_record_id:id,p_due_at:String(dueAt),p_due_has_time:Boolean(dueHasTime)
        }));
        return Object.freeze({
          recordId:id,
          dueAt:row.due_at_value ? String(row.due_at_value) : null,
          dueHasTime:row.due_has_time===true,
          previousDueAt:row.previous_due_at_value ? String(row.previous_due_at_value) : null,
          previousDueHasTime:row.previous_due_has_time===true
        });
      }catch(error){ throw translateRpcError(error); }
    },

    async undoPostpone({recordId:rawRecordId}={}){
      const id=recordId(rawRecordId);
      try{
        const row=singleRow(await client.rpc("undo_my_work_record_postpone",{p_record_id:id}));
        return Object.freeze({recordId:id,dueAt:row.due_at_value ? String(row.due_at_value) : null,dueHasTime:row.due_has_time===true});
      }catch(error){ throw translateRpcError(error); }
    },

    async setAttention({recordId:rawRecordId,nextAttentionAt=null}={}){
      const id=recordId(rawRecordId);
      if(nextAttentionAt!==null && nextAttentionAt!==undefined && !Number.isFinite(new Date(String(nextAttentionAt)).getTime())){
        throw editError("WORKLOG_DATA_CORE_ATTENTION_MUST_BE_FUTURE","다시 확인할 시간을 확인해주세요.");
      }
      try{
        const row=singleRow(await client.rpc("set_my_work_record_attention",{
          p_record_id:id,p_next_attention_at:nextAttentionAt ? String(nextAttentionAt) : null
        }));
        return Object.freeze({
          recordId:id,
          nextAttentionAt:row.next_attention_at_value ? String(row.next_attention_at_value) : null,
          previousAttentionAt:row.previous_attention_at_value ? String(row.previous_attention_at_value) : null
        });
      }catch(error){ throw translateRpcError(error); }
    },

    async undoAttention({recordId:rawRecordId,expectedAttentionAt=null,previousAttentionAt=null}={}){
      const id=recordId(rawRecordId);
      for(const value of [expectedAttentionAt,previousAttentionAt]){
        if(value!==null && value!==undefined && !Number.isFinite(new Date(String(value)).getTime())){
          throw editError("WORKLOG_DATA_CORE_ATTENTION_UNDO_STALE","다시 알림 실행 취소 정보를 확인해주세요.");
        }
      }
      try{
        const row=singleRow(await client.rpc("undo_my_work_record_attention",{
          p_record_id:id,
          p_expected_attention_at:expectedAttentionAt ? String(expectedAttentionAt) : null,
          p_previous_attention_at:previousAttentionAt ? String(previousAttentionAt) : null
        }));
        return Object.freeze({
          recordId:id,
          nextAttentionAt:row.next_attention_at_value ? String(row.next_attention_at_value) : null
        });
      }catch(error){ throw translateRpcError(error); }
    }
  });
}
