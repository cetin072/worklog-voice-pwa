export type DocumentSection = { heading?: string; level?: number; body: string };

/** Preserve the original Markdown for editing. Only heading lines become navigation targets. */
export function documentSections(markdown: string): DocumentSection[] {
  const result: DocumentSection[] = [];
  let heading: string | undefined;
  let level: number | undefined;
  let lines: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    const body = lines.join('\n').trim();
    if (heading || body) result.push({ heading, level, body });
    lines = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && !fence) {
      fence = marker[1];
      lines.push(line);
      continue;
    }
    if (fence) {
      if (marker?.[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      lines.push(line);
      continue;
    }
    const match = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match?.[2].trim()) {
      flush();
      heading = match[2].trim();
      level = match[1].length;
    } else {
      lines.push(line);
    }
  }
  flush();
  return result;
}
