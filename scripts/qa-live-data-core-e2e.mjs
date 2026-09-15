import { createHash } from 'node:crypto';

const base = process.env.QA_PREVIEW_BASE || 'https://deploy-preview-194--worklog-voice-pwa.netlify.app';
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const digest = createHash('sha256').update(`worklog-cutover:${runId}`).digest('hex');
const email = `qa-cutover-live-${runId}@example.com`;
const password = `Qa!${digest.slice(0, 28)}9!`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(res) {
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  return { text, body };
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  const { text, body } = await readJson(res);
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${url} -> ${res.status}: ${text.slice(0, 240)}`);
  return body;
}

let config;
for (let i = 0; i < 36; i += 1) {
  try {
    config = await fetchJson(`${base}/api/supabase-auth-config`);
    if (config?.configured && config?.dataCorePrimaryEnabled) break;
  } catch {}
  await sleep(5000);
}
assert(config?.configured === true, 'Preview Supabase config is not ready');
assert(config?.dataCorePrimaryEnabled === true, 'Preview Data Core primary flag is not ready');
assert(typeof config?.supabaseUrl === 'string' && config.supabaseUrl.startsWith('https://'), 'Invalid Supabase URL');
assert(typeof config?.publishableKey === 'string' && config.publishableKey.startsWith('sb_publishable_'), 'Invalid publishable key');
console.log('QA_CONFIG_PASS');

async function authRequest(path, body) {
  const res = await fetch(`${config.supabaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.publishableKey },
    body: JSON.stringify(body),
  });
  const parsed = await readJson(res);
  return { ok: res.ok, status: res.status, ...parsed };
}

let auth = await authRequest('/auth/v1/token?grant_type=password', { email, password });
if (!auth.ok) {
  const signup = await authRequest('/auth/v1/signup', { email, password });
  assert(signup.ok, `Signup failed: ${signup.status} ${signup.text.slice(0, 180)}`);
  auth = signup;
}
const token = String(auth?.body?.access_token || '');
const userId = String(auth?.body?.user?.id || '');
console.log(`QA_SIGNUP_USER_ID=${userId || 'none'}`);
assert(userId, 'Auth did not return a user id');
assert(token.length > 40, `QA_AUTH_NEEDS_CONFIRMATION user=${userId}`);
console.log('QA_AUTH_PASS');

const authHeaders = { Authorization: `Bearer ${token}` };
const restHeaders = { ...authHeaders, apikey: config.publishableKey };
let workspaceRows = [];
for (let i = 0; i < 12; i += 1) {
  workspaceRows = await fetchJson(`${config.supabaseUrl}/rest/v1/workspaces?select=id,created_by_user_id&created_by_user_id=eq.${encodeURIComponent(userId)}`, { headers: restHeaders });
  if (Array.isArray(workspaceRows) && workspaceRows.length === 1) break;
  await sleep(1000);
}
assert(Array.isArray(workspaceRows) && workspaceRows.length === 1, 'Personal Workspace bootstrap did not produce exactly one workspace');
const workspaceId = String(workspaceRows[0].id || '');
const memberRows = await fetchJson(`${config.supabaseUrl}/rest/v1/workspace_members?select=user_id,role&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}`, { headers: restHeaders });
assert(Array.isArray(memberRows) && memberRows.length === 1 && memberRows[0].role === 'owner', 'Personal Workspace owner membership missing');
console.log('QA_WORKSPACE_PASS');

function seoulDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addDays(key, days) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const tomorrow = addDays(seoulDateKey(), 1);
const scheduleRows = await fetchJson(`${config.supabaseUrl}/rest/v1/schedules`, {
  method: 'POST',
  headers: { ...restHeaders, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({
    workspace_id: workspaceId,
    created_by_user_id: userId,
    title: 'QA Cutover Schedule',
    description: 'temporary live E2E fixture',
    starts_at: `${tomorrow}T10:00:00+09:00`,
    all_day: false,
    status: 'confirmed',
    location: 'QA',
    metadata: { qa: 'production-cutover-live-e2e', runId },
  }),
});
assert(Array.isArray(scheduleRows) && scheduleRows.length === 1, 'Authenticated Schedule insert failed');
console.log('QA_SCHEDULE_WRITE_PASS');

const health = await fetchJson(`${base}/api/worklog`, { headers: authHeaders });
assert(health?.ok === true && health?.mode === 'data_core' && health?.configured === true, 'Authenticated Data Core worklog health failed');
console.log('QA_WORKLOG_HEALTH_PASS');

const requestId = `qa-live-${runId}`.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 100);
const payload = {
  clientRequestId: requestId,
  transcript: 'QA production cutover live E2E 업무',
  institution: '기타',
  status: '진행중',
  type: '할 일',
  followUp: 'temporary qa fixture',
};
const first = await fetchJson(`${base}/api/worklog`, {
  method: 'POST',
  headers: { ...authHeaders, 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
assert(first?.ok === true && first?.mode === 'data_core', 'First Data Core worklog save failed');
const recordId = String(first?.dataCoreWorkRecordId || '');
assert(/^[0-9a-f-]{36}$/i.test(recordId), 'Missing Data Core WorkRecord id');
assert(first?.notionSync === 'not_configured', 'Notion-free save unexpectedly attempted Notion sync');

const second = await fetchJson(`${base}/api/worklog`, {
  method: 'POST',
  headers: { ...authHeaders, 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
assert(String(second?.dataCoreWorkRecordId || '') === recordId, 'Retry did not dedupe to the same WorkRecord');
console.log('QA_WORKLOG_IDEMPOTENCY_PASS');

let briefing = await fetchJson(`${base}/api/briefing-v2`, { headers: authHeaders });
assert(briefing?.ok === true && briefing?.mode === 'data_core', 'Data Core briefing read failed');
assert(JSON.stringify(briefing).includes(recordId), 'Saved WorkRecord is missing from briefing');
assert(JSON.stringify(briefing?.schedules || {}).includes('QA Cutover Schedule'), 'Schedule is missing from briefing');
console.log('QA_BRIEFING_SCHEDULE_PASS');

const completed = await fetchJson(`${base}/api/briefing-v2`, {
  method: 'POST',
  headers: { ...authHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ recordId, status: '완료' }),
});
assert(completed?.ok === true && completed?.status === '완료', 'Complete mutation failed');
briefing = await fetchJson(`${base}/api/briefing-v2`, { headers: authHeaders });
assert(!JSON.stringify(briefing).includes(recordId), 'Completed WorkRecord still appears in open briefing');

const undone = await fetchJson(`${base}/api/briefing-v2`, {
  method: 'POST',
  headers: { ...authHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ recordId, status: '진행중' }),
});
assert(undone?.ok === true && undone?.status === '진행중', 'Undo mutation failed');
briefing = await fetchJson(`${base}/api/briefing-v2`, { headers: authHeaders });
assert(JSON.stringify(briefing).includes(recordId), 'Undo WorkRecord did not return to briefing');
console.log('QA_BRIEFING_MUTATION_PASS');
console.log('QA_NOTION_FREE_AUTHENTICATED_E2E_PASS');
