/** Server-verified account scope. Cleared synchronously before account transitions. */
let owner: string | null = null;
export function selectMeetingOwner(value: string | null) {
  if (value !== null && !/^[a-zA-Z0-9-]{8,80}$/.test(value)) throw Error('MEETING_OWNER_INVALID');
  owner = value;
}
export function meetingOwner() { return owner; }
export function requireMeetingOwner(expected?: string) {
  if (!owner || (expected !== undefined && expected !== owner)) throw Error('계정이 변경됐습니다. 녹음 원본은 보존했습니다. 다시 로그인해 확인해주세요.');
  return owner;
}
