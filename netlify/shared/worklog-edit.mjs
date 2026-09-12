export function normalizeWorklogTitle(value){
  return String(value ?? "")
    .replace(/\s+/g," ")
    .trim();
}

export function validWorklogPageId(value){
  const id=String(value || "").trim();
  return /^[0-9a-f]{32}$/i.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
