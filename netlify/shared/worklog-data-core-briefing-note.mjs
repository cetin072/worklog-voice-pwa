import { requireWorkspaceContext } from "./platform/workspace-context.mjs";

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(["active","acknowledged"]);

function noteError(code,message){
  const error=new Error(message);
  error.code=code;
  return error;
}

function normalizeInput({recordId,state}={}){
  const id=String(recordId || "").trim();
  const nextState=String(state || "").trim();
  if(!UUID_RE.test(id)) throw noteError("WORKLOG_DATA_CORE_NOTE_RECORD_ID_INVALID","메모 식별자가 올바르지 않습니다.");
  if(!STATES.has(nextState)) throw noteError("WORKLOG_DATA_CORE_NOTE_STATE_INVALID","메모 표시 상태가 올바르지 않습니다.");
  return Object.freeze({id,nextState});
}

export function createWorklogDataCoreBriefingNote({client}={}){
  if(!client || typeof client.update!=="function") throw noteError("WORKLOG_DATA_CORE_NOTE_CLIENT_REQUIRED","Data Core note update client가 필요합니다.");

  return Object.freeze({
    async updateStateFast(input={}){
      if(typeof client.rpc!=="function") throw noteError("WORKLOG_DATA_CORE_NOTE_FAST_RPC_REQUIRED","Data Core note fast RPC client가 필요합니다.");
      const {id,nextState}=normalizeInput(input);
      const result=await client.rpc("update_my_note_briefing_state",{p_record_id:id,p_state:nextState});
      const row=Array.isArray(result) ? result[0] : result;
      if(!row || String(row.record_id || "")!==id){
        throw noteError("WORKLOG_DATA_CORE_NOTE_NOT_FOUND_OR_FORBIDDEN","변경할 메모를 찾지 못했거나 권한이 없습니다.");
      }
      return Object.freeze({recordId:id,state:String(row.briefing_state_value || nextState)});
    },

    async updateState(input={},contextInput){
      const context=requireWorkspaceContext(contextInput);
      const {id,nextState}=normalizeInput(input);
      const rows=await client.update("work_records",{briefing_state:nextState},{
        id:`eq.${id}`,
        workspace_id:`eq.${context.workspaceId}`,
        created_by_user_id:`eq.${context.userId}`,
        action_kind:"eq.note",
      });
      if(rows.length!==1 || String(rows[0]?.id || "")!==id){
        throw noteError("WORKLOG_DATA_CORE_NOTE_NOT_FOUND_OR_FORBIDDEN","변경할 메모를 찾지 못했거나 권한이 없습니다.");
      }
      return Object.freeze({recordId:id,state:String(rows[0]?.briefing_state || nextState)});
    },
  });
}
