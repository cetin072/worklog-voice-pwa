export const INSURANCE_CUSTOMER_KEY_PATTERN = /^P-(?:[A-F0-9]{12}|DEV-[A-Z0-9]{4,32})$/;

function normalizeKey(value) {
  const key = String(value ?? "").trim().toUpperCase();
  if (!INSURANCE_CUSTOMER_KEY_PATTERN.test(key)) {
    const error = new Error("고객 식별키는 P-계열 customer_key 형식이어야 합니다.");
    error.code = "INSURANCE_CUSTOMER_KEY_INVALID";
    throw error;
  }
  return key;
}

export function createCustomerIndexAdapter({ resolveIdentity } = {}) {
  return Object.freeze({
    async resolve(customerKey) {
      const key = normalizeKey(customerKey);
      if (typeof resolveIdentity !== "function") {
        return Object.freeze({ customerKey: key, displayName: key, state: "key_only" });
      }
      const identity = await resolveIdentity(key);
      if (!identity) return Object.freeze({ customerKey: key, displayName: key, state: "not_found" });
      return Object.freeze({
        customerKey: key,
        displayName: String(identity.displayName || key).trim().slice(0, 120) || key,
        state: "resolved",
      });
    },
  });
}

export function createDefaultCustomerIndexAdapter({ hostname = "" } = {}) {
  const host = String(hostname).toLowerCase();
  const allowFixture = host === "localhost"
    || host === "127.0.0.1"
    || host.startsWith("deploy-preview-");
  const fixtures = allowFixture
    ? new Map([["P-DEV-0001", { displayName: "DEV 합성 고객" }]])
    : new Map();
  return createCustomerIndexAdapter({ resolveIdentity: async (key) => fixtures.get(key) || null });
}

export function normalizeInsuranceCustomerKey(value) {
  return normalizeKey(value);
}
