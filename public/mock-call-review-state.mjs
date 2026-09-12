function cleanText(value, max = 4000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function localDateParts(value) {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return {
    year: safe.getFullYear(),
    month: safe.getMonth() + 1,
    day: safe.getDate(),
  };
}

function formatYmd(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nextDayYmd(value) {
  const parts = localDateParts(value);
  const date = new Date(parts.year, parts.month - 1, parts.day);
  date.setDate(date.getDate() + 1);
  return formatYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function normalizeMockSelectionItem(value = {}) {
  const recordedAt = value.recordedAt ? new Date(value.recordedAt) : new Date();
  const safeRecordedAt = Number.isNaN(recordedAt.getTime()) ? new Date() : recordedAt;
  return {
    id: cleanText(value.id, 120) || `mock-${safeRecordedAt.getTime()}`,
    contactName: cleanText(value.contactName, 200) || "상대방",
    phone: cleanText(value.phone, 80),
    recordedAt: safeRecordedAt.toISOString(),
    durationSeconds: Math.max(0, Number(value.durationSeconds) || 0),
  };
}

export function buildMockCallAnalysis(value = {}, index = 0) {
  const item = normalizeMockSelectionItem(value);
  const contact = item.contactName;
  const scheduleDate = nextDayYmd(item.recordedAt);
  const suffix = index > 0 ? ` ${index + 1}` : "";

  return {
    mock: true,
    analysisVersion: "mock-v1",
    source: item,
    title: `${contact} 통화 후속조치 확인${suffix}`,
    transcript: `[모의 녹취] 실제 녹음파일을 듣지 않고 화면 검수용으로 만든 예시입니다.\n화자 1: ${contact} 관련 요청사항과 다음 일정에 대해 확인했습니다.\n화자 2: 필요한 내용을 정리하고 후속조치를 진행하기로 했습니다.`,
    summary: `${contact}와의 통화 내용을 업무수첩에서 검수하는 모의 결과입니다. 실제 STT/AI 결과가 아니며 저장 흐름 확인용입니다.`,
    keyPoints: [
      `${contact} 관련 요청사항 확인`,
      "후속 업무 담당과 진행 시점 확인",
      "일정 후보는 사용자 확인 후에만 확정",
    ],
    actions: [
      {
        id: `task-${item.id}`,
        type: "task",
        label: "할 일",
        content: `${contact} 관련 요청사항 확인하기`,
        included: true,
        confirmed: true,
      },
      {
        id: `schedule-${item.id}`,
        type: "schedule",
        label: "일정 후보",
        content: `${contact} 후속 확인`,
        included: true,
        confirmed: false,
        dueDate: scheduleDate,
        dueTime: "15:00",
      },
      {
        id: `follow-${item.id}`,
        type: "follow_up",
        label: "후속조치",
        content: `${contact}에게 진행상황 다시 확인하기`,
        included: true,
        confirmed: true,
      },
      {
        id: `decision-${item.id}`,
        type: "decision",
        label: "결정사항",
        content: "통화에서 합의된 내용을 검토 후 업무기록에 반영", 
        included: true,
        confirmed: true,
      },
    ],
    contacts: [
      {
        id: `contact-${item.id}`,
        name: contact,
        phone: item.phone,
        role: "통화 상대 후보",
        included: Boolean(item.phone || contact !== "상대방"),
        confirmed: false,
      },
    ],
  };
}

export function buildMockReviewPayload(result = {}) {
  const source = normalizeMockSelectionItem(result.source || {});
  const keyPoints = (Array.isArray(result.keyPoints) ? result.keyPoints : [])
    .map((item) => cleanText(item, 1000))
    .filter(Boolean)
    .slice(0, 20);

  const actions = (Array.isArray(result.actions) ? result.actions : [])
    .filter((item) => item?.included)
    .map((item) => {
      const type = cleanText(item.type, 40);
      const base = {
        type,
        content: cleanText(item.content, 2000),
        confirmed: type === "schedule" ? Boolean(item.confirmed) : true,
      };
      if (type === "schedule") {
        base.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.dueDate || "")) ? item.dueDate : "";
        base.dueTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.dueTime || "")) ? item.dueTime : "";
        if (!base.dueDate) base.confirmed = false;
      }
      return base;
    })
    .filter((item) => item.content);

  const contacts = (Array.isArray(result.contacts) ? result.contacts : [])
    .filter((item) => item?.included)
    .map((item) => ({
      name: cleanText(item.name, 200),
      phone: cleanText(item.phone, 80),
      role: cleanText(item.role, 200),
      confirmed: Boolean(item.confirmed),
    }))
    .filter((item) => item.name || item.phone);

  return {
    mock: true,
    savedAt: new Date().toISOString(),
    source,
    title: cleanText(result.title, 200),
    summary: cleanText(result.summary, 6000),
    transcript: cleanText(result.transcript, 12000),
    keyPoints,
    actions,
    contacts,
  };
}

export function mockReviewStats(payload = {}) {
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  return {
    tasks: actions.filter((item) => item.type === "task").length,
    schedules: actions.filter((item) => item.type === "schedule").length,
    confirmedSchedules: actions.filter((item) => item.type === "schedule" && item.confirmed).length,
    followUps: actions.filter((item) => item.type === "follow_up").length,
    decisions: actions.filter((item) => item.type === "decision").length,
    contacts: Array.isArray(payload.contacts) ? payload.contacts.length : 0,
  };
}
