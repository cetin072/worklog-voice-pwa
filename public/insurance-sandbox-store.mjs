const STORAGE_KEY = "worklogInsuranceSandboxV1";

export const INSURANCE_SANDBOX_SOURCE_ID = "22222222-2222-4222-8222-222222222222";

export function isInsuranceSandboxHost(hostname = "") {
  const host = String(hostname).toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host.includes("worklog-insurance-sandbox");
}

function emptyStore() {
  return { cases: [], actions: [] };
}

function readStore(storage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    return value && Array.isArray(value.cases) && Array.isArray(value.actions) ? value : emptyStore();
  } catch {
    return emptyStore();
  }
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() || "11111111-1111-4111-8111-111111111111";
}

function row(store, item) {
  const action = store.actions.find((entry) => entry.work_record_id === item.current_action_work_record_id);
  return {
    ...item,
    current_action_title: action?.title || null,
    current_action_status: action?.status || null,
    current_action_due_at: action?.due_at || null,
  };
}

export function createInsuranceSandboxRpc({ storage = globalThis.localStorage } = {}) {
  const save = (store) => storage.setItem(STORAGE_KEY, JSON.stringify(store));

  return async (name, body = {}) => {
    const store = readStore(storage);

    if (name === "get_my_work_record_edit") {
      if (body.p_record_id !== INSURANCE_SANDBOX_SOURCE_ID) return [];
      return [{ id: INSURANCE_SANDBOX_SOURCE_ID, title_value: "DEV 합성 고객 보험 문의 확인" }];
    }

    if (name === "list_my_insurance_cases") return store.cases.map((item) => row(store, item));

    if (name === "get_my_insurance_case") {
      const item = store.cases.find((entry) => entry.insurance_case_id === body.p_insurance_case_id);
      return item ? [row(store, item)] : [];
    }

    if (name === "create_my_insurance_case") {
      const existing = store.cases.find((entry) => entry.client_request_id === body.p_client_request_id);
      if (existing) return [row(store, existing)];
      const item = {
        insurance_case_id: uuid(),
        client_request_id: body.p_client_request_id,
        original_work_record_id: body.p_original_work_record_id,
        original_work_record_title: "DEV 합성 고객 보험 문의 확인",
        customer_key: body.p_customer_key,
        title: body.p_title,
        status: "intake",
        waiting_party: null,
        waiting_reason: null,
        current_action_work_record_id: null,
        revision: 1,
      };
      store.cases.unshift(item);
      save(store);
      return [row(store, item)];
    }

    if (name === "update_my_insurance_case") {
      const item = store.cases.find((entry) => entry.insurance_case_id === body.p_insurance_case_id);
      if (!item || item.revision !== body.p_expected_revision) return [];
      Object.assign(item, {
        title: body.p_title,
        status: body.p_status,
        waiting_party: body.p_waiting_party,
        waiting_reason: body.p_waiting_reason,
        revision: item.revision + 1,
      });
      save(store);
      return [row(store, item)];
    }

    if (name === "create_my_insurance_case_action") {
      const existing = store.actions.find((entry) => entry.client_request_id === body.p_client_request_id);
      if (existing) return [{ insurance_case_id: existing.insurance_case_id, action_work_record_id: existing.work_record_id, action_status: existing.status }];
      const item = store.cases.find((entry) => entry.insurance_case_id === body.p_insurance_case_id);
      if (!item) return [];
      const action = {
        work_record_id: uuid(),
        insurance_case_id: item.insurance_case_id,
        client_request_id: body.p_client_request_id,
        title: body.p_title,
        due_at: body.p_due_at,
        status: "in_progress",
      };
      store.actions.push(action);
      item.current_action_work_record_id = action.work_record_id;
      item.revision += 1;
      save(store);
      return [{ insurance_case_id: item.insurance_case_id, action_work_record_id: action.work_record_id, action_status: action.status }];
    }

    if (name === "update_my_work_record_status") {
      const action = store.actions.find((entry) => entry.work_record_id === body.p_record_id);
      if (!action) return [];
      action.status = body.p_status;
      save(store);
      return [{ work_record_id: action.work_record_id, status: action.status }];
    }

    throw new Error(`지원하지 않는 Sandbox 요청입니다: ${name}`);
  };
}
