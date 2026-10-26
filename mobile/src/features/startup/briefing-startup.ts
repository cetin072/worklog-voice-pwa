// An empty/partial successful briefing is ready; background work must not hide it.
export function initialBriefingState(hasBriefing: boolean, error: string) {
  return hasBriefing ? 'ready' : error ? 'error' : 'loading';
}
