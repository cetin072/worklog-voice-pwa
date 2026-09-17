import * as SecureStore from 'expo-secure-store';

const LAST_LOGIN_EMAIL_KEY = 'worklog-mobile:last-login-email';

export async function loadRememberedLoginEmail() {
  const value = await SecureStore.getItemAsync(LAST_LOGIN_EMAIL_KEY);
  return String(value || '').trim();
}

export async function saveRememberedLoginEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await SecureStore.setItemAsync(LAST_LOGIN_EMAIL_KEY, normalized);
}
