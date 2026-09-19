import { createHash } from "node:crypto";

const SPLIT_MARKER="<<<WORK_SPLIT>>>";
export const MULTI_ACTION_MAX_SEGMENTS=8;

export const MULTI_ACTION_SPLIT_RE=/(?:^|\s)(?:(?:그리고\s+)?(?:그\s*다음|그다음)(?:\s*(?:업무|건|거|내용|일정|할\s*일)(?:은|는|도|으로)?)?|(?:그리고\s+)?다음\s*(?:업무|건|거|내용|일정|할\s*일)(?:은|는|도|으로)?|(?:그리고\s+)?다음(?:은|으로)|또\s+다른\s+(?:업무|건|거|일|일정)(?:은|는|도)?|별개(?:의)?\s+(?:업무|건|일)|별도\s+(?:업무|건|일)|새(?:로운)?\s+(?:업무|건|일)|두\s*번째\s+(?:업무|건|일)|세\s*번째\s+(?:업무|건|일)|네\s*번째\s+(?:업무|건|일))(?=\s|[,.!?]|$)/gi;

function normalize(value){
  return String(value ?? "").replace(/\s+/g," ").trim();
}

function cleanSegment(value){
  return normalize(value).replace(/^[,.;:!?\-–—]+\s*/,"");
}

export function splitMultiActionText(value,{maxSegments=MULTI_ACTION_MAX_SEGMENTS}={}){
  const source=normalize(value);
  if(!source) return Object.freeze({source:"",segments:Object.freeze([]),matched:false,truncated:false});

  const marked=source.replace(MULTI_ACTION_SPLIT_RE,` ${SPLIT_MARKER} `);
  const segments=marked
    .split(SPLIT_MARKER)
    .map(cleanSegment)
    .filter(Boolean);

  if(segments.length<=1){
    return Object.freeze({source,segments:Object.freeze([source]),matched:false,truncated:false});
  }

  if(segments.length>maxSegments){
    return Object.freeze({
      source,
      segments:Object.freeze(segments.slice(0,maxSegments)),
      matched:true,
      truncated:true,
    });
  }

  return Object.freeze({source,segments:Object.freeze(segments),matched:true,truncated:false});
}

export function multiActionChildRequestId(parentRequestId,index){
  const parent=normalize(parentRequestId);
  const position=Number(index);
  if(!/^[A-Za-z0-9-]{16,100}$/.test(parent)) throw new Error("MULTI_ACTION_PARENT_REQUEST_ID_INVALID");
  if(!Number.isInteger(position) || position<0 || position>=MULTI_ACTION_MAX_SEGMENTS) throw new Error("MULTI_ACTION_INDEX_INVALID");

  const hashText=createHash("md5").update(parent).digest("hex").slice(0,24);
  return `multi-${hashText}-${String(position+1).padStart(2,"0")}`;
}
