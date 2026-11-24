import {
  countKoreanDateSignals,
  extractJournalDateFromText,
  formatYmd,
  parseKoreanTimeExpression,
  seoulDateParts,
} from "./korean-date-core.mjs";
import { extractScheduleFromText } from "./schedule-extract.mjs";

const EVENT_SIGNAL_RE=/(미팅|약속|면담|상담|방문|만나|통화|전화(?!번호)|인터뷰|행사|교육|세미나|촬영|식사|점심|저녁|출발|도착|회의(?!\s*(?:자료|록|안건|준비|내용|비)))/;
const REMINDER_SIGNAL_RE=/(알림|리마인더|리마인드|알려\s*줘|알려줘|깨워)/;
const RELATIVE_TIME_SIGNAL_RE=/\d{1,3}\s*(?:분|시간)\s*(?:뒤|후)(?:로)?/;
const MOVEMENT_RE=/(?:[가-힣A-Za-z0-9]+(?:으로|로|에)\s*(?:가(?:기|는|야|자|요|겠습니다)|이동)|[가-힣A-Za-z0-9]*(?:IC|ic|역|공항|터미널|회사|병원)\s*가(?:기|는|야|자|요|겠습니다))/;
const NEGATED_EVENT_RE=/(?:가지|이동하지|알리지|알려주지)\s*마|안\s*(?:가|알려)|알림\s*(?:취소|필요\s*없)/;
const DEADLINE_RE=/까지[\s\S]{0,40}(?:제출|보내|전달|완료|처리|보고|정리|준비|확인|작성|수정|회신|납부|입금|신고|결제|송금|지급)|(?:마감|제출\s*기한|완료\s*기한)(?=$|\s*(?:[,.!?]|인\s|이야|입니다))/;
const EXPLICIT_TASK_RE=/(?:^|\s)할\s*일\s*(?:[:：,]|로(?:\s|$)|(?=$|[.!?]))/;
const EXPLICIT_NOTE_RE=/(?:^|\s)메모\s*(?:[:：,]|로(?:\s|$)|(?:해\s*줘)?(?=$|[.!?]))|^메모\s+(?=오늘|내일|모레|글피|이번|다음|\d)/;
const CANCELED_NOTE_RE=/(?:^|\s)취소(?:\s*(?:했(?:어요?|음)|해\s*줘|됨|됐(?:어요?|음)|되었(?:어요?|음)))?(?=$|[.!?])/;
const STRONG_TASK_RE=/(?:해야\s*(?:해|돼|함|한다|겠|할)|할\s*것|하기|보내기|전달하기|제출하기|확인하기|전화하기|연락하기|정리하기|준비하기|검토하기|처리하기|보고하기|작성하기|수정하기|회신하기|예약하기|신청하기|문의하기|챙기기|납부하기|입금하기|신고하기|결제하기|송금하기|지급하기|받기)|(?:보내|전달|제출|확인|전화|연락|정리|준비|검토|처리|보고|작성|수정|회신|예약|신청|문의|챙기)(?:야|해|하자|할게|할 것|부터|$)/;
const ACTIONISH_RE=/(확인|검토|연락|전화|보내|전달|제출|정리|준비|처리|보고|작성|수정|회신|예약|신청|문의|챙기|방문|만나|보자|체크)/;
const REPORTING_NOTE_RE=/(?:다고|라고|한다고|했다고|예정이라고)\s*(?:함|했음|말함|전달받|연락받)|(?:연락|회신)\s*(?:옴|왔|받음)|(?:접수|승인|확정|변경|취소)\s*(?:됐|되었|됨)|(?:예정|상태|내용)\s*(?:임|이라고 함)/;
const IDEA_NOTE_RE=/(아이디어|생각남|메모|참고|기억해둘|기억할)/;

function normalize(value){
  return String(value ?? "").replace(/\s+/g," ").trim();
}

function validRecordedDate(value){
  const parts=seoulDateParts(value || new Date());
  if(!parts) return "";
  const date=new Date(Date.UTC(parts.year,parts.month-1,parts.day));
  return formatYmd(date);
}

function explicitTypeKind(type){
  const value=normalize(type);
  if(value==="아이디어") return "note";
  if(["완료업무","할 일","지출·세무","지시·위임","문제·확인"].includes(value)) return "task";
  return "";
}

function hasExplicitTime(value){
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(String(value || ""));
}

function isDeadline(source,clock){
  return DEADLINE_RE.test(source) || Boolean(clock && /^\s*까지/.test(source.slice(clock.index+clock.raw.length)));
}

export function isTimedScheduleIntent({source="",dueStart="",recordType="",explicitType="",dateSpecified}={}){
  const text=normalize(source);
  if(!text || !hasExplicitTime(dueStart)) return false;
  const clock=parseKoreanTimeExpression(text);
  if(explicitTypeKind(explicitType) || EXPLICIT_TASK_RE.test(text) || EXPLICIT_NOTE_RE.test(text) ||
     NEGATED_EVENT_RE.test(text) || CANCELED_NOTE_RE.test(text) || isDeadline(text,clock)) return false;

  if(dateSpecified ?? (Boolean(clock) && countKoreanDateSignals(text)===1)) return true;

  const eventText=(clock ? text.replace(clock.raw," ") : text).replace(/(?:아침|점심|저녁)\s*\d{1,2}\s*시/g," ");
  return EVENT_SIGNAL_RE.test(eventText) || recordType==="meeting_call" || normalize(explicitType)==="회의·통화" ||
    (RELATIVE_TIME_SIGNAL_RE.test(text) && (REMINDER_SIGNAL_RE.test(text) || MOVEMENT_RE.test(text)) && !REPORTING_NOTE_RE.test(text) && !IDEA_NOTE_RE.test(text));
}

function result({kind,journalDate,reason,confidence,needsReview=false,schedule}){
  return Object.freeze({
    kind,
    actionKind: kind==="task" || kind==="note" ? kind : null,
    journalDate,
    reason,
    confidence,
    needsReview,
    schedule: schedule ? Object.freeze({
      matched:Boolean(schedule.matched),
      hasTime:Boolean(schedule.hasTime),
      dateKey:String(schedule.dateKey || ""),
      dueStart:String(schedule.dueStart || ""),
    }) : null,
  });
}

export function classifyWorklogAction({
  transcript,
  recordedAt=new Date(),
  explicitType="",
  schedule:providedSchedule,
}={}){
  const source=normalize(transcript);
  const fallbackDate=validRecordedDate(recordedAt);
  if(!source){
    return result({kind:"note",journalDate:fallbackDate,reason:"empty_source",confidence:0,needsReview:true});
  }

  const schedule=providedSchedule || extractScheduleFromText(source,recordedAt);
  const journal=extractJournalDateFromText(source,recordedAt);
  const scheduleDate=String(schedule?.dateKey || "");
  const journalDate=journal.matched
    ? journal.dateKey
    : (!journal.ambiguous && schedule?.matched && scheduleDate ? scheduleDate : (journal.dateKey || fallbackDate));
  const dateAmbiguous=Boolean(journal.ambiguous);

  const historicalDateOutsideSchedule=journal.matched && journal.dateKey<fallbackDate && journal.dateKey!==scheduleDate;
  if(!historicalDateOutsideSchedule && isTimedScheduleIntent({source,dueStart:schedule?.dueStart,explicitType,dateSpecified:schedule?.dateSpecified})){
    return result({
      kind:"schedule",
      journalDate,
      reason:"timed_event",
      confidence:dateAmbiguous ? 0.7 : 0.98,
      needsReview:dateAmbiguous,
      schedule,
    });
  }

  const forced=explicitTypeKind(explicitType);
  if(forced){
    return result({
      kind:forced,
      journalDate,
      reason:`explicit_type_${forced}`,
      confidence:dateAmbiguous ? 0.75 : 0.99,
      needsReview:dateAmbiguous,
      schedule,
    });
  }

  if(EXPLICIT_NOTE_RE.test(source) || CANCELED_NOTE_RE.test(source) || historicalDateOutsideSchedule){
    return result({kind:"note",journalDate,reason:historicalDateOutsideSchedule ? "reported_fact" : "idea_or_memo",
      confidence:dateAmbiguous ? 0.72 : 0.94,needsReview:dateAmbiguous,
      schedule:historicalDateOutsideSchedule ? null : schedule});
  }

  const deadline=isDeadline(source,parseKoreanTimeExpression(source));
  if(deadline || EXPLICIT_TASK_RE.test(source) || STRONG_TASK_RE.test(source)){
    return result({
      kind:"task",
      journalDate,
      reason:deadline ? "deadline_action" : "explicit_action",
      confidence:dateAmbiguous ? 0.72 : 0.94,
      needsReview:dateAmbiguous,
      schedule,
    });
  }

  if(REPORTING_NOTE_RE.test(source) || IDEA_NOTE_RE.test(source)){
    return result({
      kind:"note",
      journalDate,
      reason:IDEA_NOTE_RE.test(source) ? "idea_or_memo" : "reported_fact",
      confidence:dateAmbiguous ? 0.72 : 0.94,
      needsReview:dateAmbiguous,
      schedule,
    });
  }

  if(ACTIONISH_RE.test(source)){
    return result({
      kind:"task",
      journalDate,
      reason:"ambiguous_action",
      confidence:0.58,
      needsReview:true,
      schedule,
    });
  }

  return result({
    kind:"note",
    journalDate,
    reason:"informational_default",
    confidence:dateAmbiguous ? 0.6 : 0.82,
    needsReview:dateAmbiguous,
    schedule,
  });
}
