const NOTION_PAGES_URL = "https://api.notion.com/v1/pages";

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function boundedText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function richText(value) {
  const content = boundedText(value, 2000);
  return { rich_text: content ? [{ type: "text", text: { content } }] : [] };
}

function title(value) {
  const content = boundedText(value, 160);
  return { title: [{ type: "text", text: { content } }] };
}

export function makeNotionWorklogTitle(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= 60 ? text : `${text.slice(0, 57)}…`;
}

export function toNotionWorklogPagePayload(record = {}, dataSourceId) {
  const cleanTranscript = boundedText(record.cleanTranscript, 1800);
  const transcript = boundedText(record.transcript, 1800);
  const type = boundedText(record.type, 80);
  const properties = {
    "업무명": title(makeNotionWorklogTitle(cleanTranscript)),
    "기관": { select: { name: boundedText(record.institution, 60) || "기타" } },
    "상태": { select: { name: boundedText(record.status, 80) || "진행중" } },
    "유형": { select: { name: type || "기타" } },
    "기록일": { date: { start: boundedText(record.recordedDate, 32) } },
    "내용": richText(cleanTranscript),
    "음성원문": richText(transcript),
    "증빙": { select: { name: type === "지출·세무" ? "미첨부" : "해당없음" } },
  };
  if (typeof record.amount === "number" && Number.isFinite(record.amount)) properties["금액"] = { number: record.amount };
  if (boundedText(record.assignee, 2000)) properties["담당자"] = richText(record.assignee);
  if (boundedText(record.followUp, 2000)) properties["후속조치"] = richText(record.followUp);
  if (boundedText(record.dueStart, 32)) properties["기한"] = { date: { start: boundedText(record.dueStart, 32) } };
  return {
    parent: { type: "data_source_id", data_source_id: boundedText(dataSourceId, 100) },
    properties,
  };
}

export function createNotionWorklogAdapter({ token, dataSourceId, notionVersion, fetchImpl = fetch } = {}) {
  const safeToken = boundedText(token, 300);
  const safeDataSourceId = boundedText(dataSourceId, 100);
  const safeVersion = boundedText(notionVersion, 32);
  if (!safeToken || !safeDataSourceId || !safeVersion) {
    throw adapterError("NOTION_WORKLOG_CONFIG_REQUIRED", "Notion Worklog adapter 설정이 필요합니다.");
  }
  if (typeof fetchImpl !== "function") throw adapterError("NOTION_WORKLOG_FETCH_REQUIRED", "Notion fetch 구현이 필요합니다.");

  return Object.freeze({
    async create(record) {
      const response = await fetchImpl(NOTION_PAGES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${safeToken}`,
          "Content-Type": "application/json",
          "Notion-Version": safeVersion,
        },
        body: JSON.stringify(toNotionWorklogPagePayload(record, safeDataSourceId)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw adapterError("NOTION_WORKLOG_WRITE_FAILED", "Notion Worklog 저장에 실패했습니다.", {
          notionStatus: response.status,
          notionCode: String(data?.code || data?.message || ""),
        });
      }
      return Object.freeze({ pageId: String(data?.id || ""), url: String(data?.url || "") });
    },
  });
}
