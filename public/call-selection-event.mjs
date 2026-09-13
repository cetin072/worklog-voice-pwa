function cleanText(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeRecordedAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function buildCallSelectionItems(selected = []) {
  if (!Array.isArray(selected)) return [];

  return selected.map((entry, index) => {
    const parsed = entry?.parsed || {};
    const file = entry?.file || {};
    const duration = Number(entry?.duration);
    return {
      id: `call-${cleanText(entry?.id, 40) || index + 1}`,
      contactName: cleanText(parsed.contact || parsed.phoneDisplay || "상대방", 200) || "상대방",
      phone: cleanText(parsed.phoneDisplay || parsed.phone || "", 80),
      recordedAt: safeRecordedAt(parsed.recordedAt),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
      fileName: cleanText(file.name, 255),
      mimeType: cleanText(file.type, 120).toLowerCase(),
      fileSize: Math.max(0, Number(file.size) || 0),
      lastModified: Math.max(0, Number(file.lastModified) || 0),
    };
  });
}
