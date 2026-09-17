import { createInsuranceCaseClient } from "./insurance-case-client.mjs";
import { createDefaultCustomerIndexAdapter } from "./insurance-customer-index-adapter.mjs";

const $ = (id) => document.getElementById(id);
const STATUS_LABELS = Object.freeze({ intake: "문의접수", checking: "확인중", waiting: "대기", active: "진행중", closed: "종결" });
const ACTION_STATUS_LABELS = Object.freeze({ in_progress: "진행중", waiting: "대기", needs_review: "확인필요", completed: "완료", cancelled: "취소" });
const PENDING_KEY = "worklogInsurancePendingRequestsV1";
const PENDING_MAX_AGE = 30 * 60 * 1000;
let activeCase = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readPending() {
  try {
    const rows = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    const cutoff = Date.now() - PENDING_MAX_AGE;
    const active = Array.isArray(rows) ? rows.filter((row) => row?.id && Number(row.at || 0) >= cutoff) : [];
    localStorage.setItem(PENDING_KEY, JSON.stringify(active));
    return active;
  } catch {
    localStorage.removeItem(PENDING_KEY);
    return [];
  }
}

function nextRequestId(scope, fingerprint) {
  const rows = readPending();
  const existing = rows.find((row) => row.scope === scope && row.fingerprint === fingerprint);
  if (existing) return existing.id;
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  rows.push({ scope, fingerprint, id, at: Date.now() });
  localStorage.setItem(PENDING_KEY, JSON.stringify(rows));
  return id;
}

function clearRequestId(id) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(readPending().filter((row) => row.id !== id)));
}

function setStatus(message, kind = "") {
  const node = $("insuranceStatus");
  if (!node) return;
  node.textContent = message;
  node.className = `insurance-status ${kind}`.trim();
}

async function rpc(name, body, retry = true) {
  const auth = window.WorklogPlatformAuth;
  const config = await auth?.getConfig?.();
  let session = auth?.readSession?.();
  if (!config?.supabaseUrl || !config?.publishableKey || !session?.access_token) {
    throw new Error("로그인 후 보험팩을 사용할 수 있습니다.");
  }
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.publishableKey,
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  if (response.status === 401 && retry && auth?.refreshSession) {
    await auth.refreshSession();
    return rpc(name, body, false);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.message || data?.hint || "보험사건 요청을 처리하지 못했습니다."));
    error.code = String(data?.code || "INSURANCE_REQUEST_FAILED");
    throw error;
  }
  return data;
}

const client = createInsuranceCaseClient({ rpc, nextRequestId, clearRequestId });
const customers = createDefaultCustomerIndexAdapter({ hostname: location.hostname });

function dueLabel(value) {
  const raw = String(value || "");
  if (!raw) return "기한 없음";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "기한 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

async function customerDisplay(key) {
  try { return await customers.resolve(key); }
  catch { return { customerKey: String(key || ""), displayName: String(key || ""), state: "invalid" }; }
}

function showOnly(sectionId) {
  ["insuranceListSection", "insuranceCreateSection", "insuranceDetailSection"].forEach((id) => {
    const node = $(id);
    if (node) node.hidden = id !== sectionId;
  });
}

async function renderList() {
  showOnly("insuranceListSection");
  const cases = await client.list();
  const rows = await Promise.all(cases.map(async (item) => ({ item, customer: await customerDisplay(item.customer_key) })));
  $("insuranceCaseList").innerHTML = rows.map(({ item, customer }) => {
    const action = item.current_action_title
      ? `<p class="insurance-case-action">다음 행동: ${escapeHtml(item.current_action_title)} · ${escapeHtml(dueLabel(item.current_action_due_at))}</p>`
      : '<p class="insurance-case-action">다음 행동 없음</p>';
    return `<li class="insurance-case-item"><a href="/insurance.html?case=${encodeURIComponent(item.insurance_case_id)}"><strong>${escapeHtml(item.title)}</strong><div class="insurance-case-meta"><span>${escapeHtml(customer.displayName)}</span><span>${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span></div>${action}</a></li>`;
  }).join("");
  $("insuranceCaseCount").textContent = `${cases.length}건`;
  $("insuranceCaseEmpty").hidden = cases.length > 0;
  setStatus("보험사건을 최신 상태로 불러왔습니다.", "is-ready");
}

async function renderCreate(workRecordId) {
  showOnly("insuranceCreateSection");
  const source = await client.readSource(workRecordId);
  $("insuranceCreateSource").textContent = String(source.title_value || "원본 업무");
  $("insuranceCaseTitle").value = String(source.title_value || "").slice(0, 200);
  $("insuranceCreateForm").dataset.workRecordId = workRecordId;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname.startsWith("deploy-preview-")) {
    $("insuranceCustomerKey").value = "P-DEV-0001";
  }
  setStatus("원본 업무는 그대로 유지되며 사건은 ID로 연결됩니다.");
}

async function renderDetail(caseId) {
  showOnly("insuranceDetailSection");
  activeCase = await client.get(caseId);
  const customer = await customerDisplay(activeCase.customer_key);
  $("insuranceDetailHeading").textContent = activeCase.title;
  $("insuranceDetailCustomer").textContent = customer.displayName;
  $("insuranceDetailCustomerState").textContent = customer.state === "resolved" ? "Customer Index 확인" : "식별키 연결";
  $("insuranceDetailOriginal").textContent = activeCase.original_work_record_title || "원본 업무";
  $("insuranceDetailTitle").value = activeCase.title;
  $("insuranceDetailStatus").value = activeCase.status;
  $("insuranceWaitingParty").value = activeCase.waiting_party || "";
  $("insuranceWaitingReason").value = activeCase.waiting_reason || "";

  const action = $("insuranceCurrentAction");
  const complete = $("insuranceCompleteAction");
  if (activeCase.current_action_work_record_id) {
    action.innerHTML = `<strong>${escapeHtml(activeCase.current_action_title || "다음 행동")}</strong><small>${escapeHtml(ACTION_STATUS_LABELS[activeCase.current_action_status] || activeCase.current_action_status || "상태 확인")} · ${escapeHtml(dueLabel(activeCase.current_action_due_at))}</small>`;
    complete.hidden = activeCase.current_action_status === "completed" || activeCase.current_action_status === "cancelled";
  } else {
    action.textContent = "다음 행동이 없습니다.";
    complete.hidden = true;
  }
  $("insuranceActionForm").querySelector("button").disabled = activeCase.status === "closed";
  setStatus(activeCase.status === "closed" ? "종결된 사건입니다. 상태를 바꾸면 다시 진행할 수 있습니다." : "사건과 다음 행동을 확인했습니다.", "is-ready");
}

async function initialize() {
  const auth = window.WorklogPlatformAuth;
  const session = auth?.readSession?.();
  if (!session?.access_token) {
    $("insuranceSignedOut").hidden = false;
    setStatus("로그인이 필요합니다.", "is-error");
    return;
  }
  try {
    await auth.bootstrapPersonalWorkspace();
    const params = new URLSearchParams(location.search);
    const caseId = params.get("case");
    const workRecordId = params.get("workRecordId");
    if (caseId) await renderDetail(caseId);
    else if (workRecordId) await renderCreate(workRecordId);
    else await renderList();
  } catch (error) {
    setStatus(error?.message || "보험팩을 준비하지 못했습니다.", "is-error");
  }
}

$("insuranceCreateForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const customer = await customers.resolve($("insuranceCustomerKey").value);
    if (customer.state !== "resolved") {
      const error = new Error("Customer Index에서 확인된 고객만 연결할 수 있습니다.");
      error.code = "INSURANCE_CUSTOMER_NOT_RESOLVED";
      throw error;
    }
    const result = await client.create({ originalWorkRecordId: form.dataset.workRecordId, customerKey: customer.customerKey, title: $("insuranceCaseTitle").value });
    location.assign(`/insurance.html?case=${encodeURIComponent(result.insurance_case_id)}`);
  } catch (error) {
    setStatus(error?.message || "보험사건을 만들지 못했습니다.", "is-error");
    button.disabled = false;
  }
});

$("insuranceDetailForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await client.update({ insuranceCaseId: activeCase.insurance_case_id, expectedRevision: activeCase.revision, title: $("insuranceDetailTitle").value, status: $("insuranceDetailStatus").value, waitingParty: $("insuranceWaitingParty").value, waitingReason: $("insuranceWaitingReason").value });
    await renderDetail(activeCase.insurance_case_id);
  } catch (error) {
    setStatus(error?.message || "사건을 저장하지 못했습니다. 최신 상태를 다시 확인해 주세요.", "is-error");
  } finally { button.disabled = false; }
});

$("insuranceActionForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await client.createAction({ insuranceCaseId: activeCase.insurance_case_id, title: $("insuranceActionTitle").value, dueAt: $("insuranceActionDue").value });
    $("insuranceActionTitle").value = "";
    $("insuranceActionDue").value = "";
    await renderDetail(activeCase.insurance_case_id);
  } catch (error) {
    setStatus(error?.message || "다음 행동을 만들지 못했습니다.", "is-error");
  } finally { button.disabled = false; }
});

$("insuranceCompleteAction")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!activeCase?.current_action_work_record_id) return;
  button.disabled = true;
  try {
    await client.completeAction(activeCase.current_action_work_record_id);
    await renderDetail(activeCase.insurance_case_id);
  } catch (error) {
    setStatus(error?.message || "다음 행동을 완료하지 못했습니다.", "is-error");
  } finally { button.disabled = false; }
});

window.addEventListener("DOMContentLoaded", initialize, { once: true });
