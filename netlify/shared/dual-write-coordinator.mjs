function dualWriteError(code, message, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); return error; }

export function createDualWriteCoordinator({ writeDataCore, writeNotion, saveProgress = async () => {} } = {}) {
  if (typeof writeDataCore !== "function" || typeof writeNotion !== "function") throw dualWriteError("DUAL_WRITE_WRITER_REQUIRED", "Data Core와 Notion writer가 필요합니다.");
  return Object.freeze({
    async execute(record, existing = {}) {
      const progress = { dataCore: existing.dataCore || null, notion: existing.notion || null };
      const failures = [];
      if (!progress.dataCore) {
        try { progress.dataCore = await writeDataCore(record); await saveProgress(progress); }
        catch (error) { failures.push({ target: "data_core", code: error?.code || "DATA_CORE_WRITE_FAILED", message: String(error?.message || "Data Core 저장 실패") }); }
      }
      if (!progress.notion) {
        try { progress.notion = await writeNotion(record); await saveProgress(progress); }
        catch (error) { failures.push({ target: "notion", code: error?.code || "NOTION_WRITE_FAILED", message: String(error?.message || "Notion 저장 실패") }); }
      }
      if (!progress.dataCore && !progress.notion) throw dualWriteError("DUAL_WRITE_ALL_FAILED", "Data Core와 Notion 저장에 모두 실패했습니다.", { failures });
      return Object.freeze({ dataCore: progress.dataCore, notion: progress.notion, failures: Object.freeze(failures), complete: Boolean(progress.dataCore && progress.notion) });
    },
  });
}
