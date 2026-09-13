import { STT_PROVIDER_IDS } from "./provider-adapter-contract.mjs";

const SUPPORTED = new Set(STT_PROVIDER_IDS);

function clean(value, max = 80) {
  return String(value ?? "").trim().toLowerCase().slice(0, max);
}

export function normalizeSttProviderId(value) {
  const id = clean(value);
  return SUPPORTED.has(id) ? id : "";
}

export function resolveSttProviderSelection(input = {}) {
  const rawProviderId = clean(input.providerId);
  const providerId = normalizeSttProviderId(rawProviderId);
  const selected = Boolean(providerId);
  const supported = !rawProviderId || selected;
  const adapter = selected ? input.registry?.stt?.[providerId] || null : null;
  const adapterConfigured = adapter?.configured === true;
  const limitsConfirmed = input.limitsConfirmed === true;

  let reason = "ready";
  if (!rawProviderId) reason = "provider_not_selected";
  else if (!supported) reason = "provider_not_supported";
  else if (!limitsConfirmed) reason = "provider_limits_unconfirmed";
  else if (!adapterConfigured) reason = "provider_adapter_not_configured";

  return Object.freeze({
    providerId,
    selected,
    supported,
    limitsConfirmed,
    adapterConfigured,
    ready: selected && limitsConfirmed && adapterConfigured,
    reason,
  });
}
