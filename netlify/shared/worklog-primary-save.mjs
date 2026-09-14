function primarySaveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createWorklogPrimarySave({ writeDataCore, writeNotion = null, saveProgress = async () => {} } = {}) {
  if (typeof writeDataCore !== "function") throw primarySaveError("WORKLOG_PRIMARY_DATA_CORE_WRITER_REQUIRED", "Data Core writer가 필요합니다.");
  if (writeNotion !== null && typeof writeNotion !== "function") throw primarySaveError("WORKLOG_PRIMARY_NOTION_WRITER_INVALID", "Notion writer 형식이 올바르지 않습니다.");

  return Object.freeze({
    async execute(record, existing = {}) {
      const progress = { dataCore: existing.dataCore || null, notion: existing.notion || null };
      if (!progress.dataCore) {
        progress.dataCore = await writeDataCore(record);
        await saveProgress(progress);
      }

      if (!writeNotion) return Object.freeze({ dataCore: progress.dataCore, notion: progress.notion, notionSync: "not_configured", notionErrorCode: "" });
      if (progress.notion) return Object.freeze({ dataCore: progress.dataCore, notion: progress.notion, notionSync: "synced", notionErrorCode: "" });

      try {
        progress.notion = await writeNotion(record);
        await saveProgress(progress);
        return Object.freeze({ dataCore: progress.dataCore, notion: progress.notion, notionSync: "synced", notionErrorCode: "" });
      } catch (error) {
        return Object.freeze({ dataCore: progress.dataCore, notion: null, notionSync: "pending", notionErrorCode: String(error?.code || "NOTION_WRITE_FAILED") });
      }
    },
  });
}
