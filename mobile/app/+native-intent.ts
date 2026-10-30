/** Only Expo share intents are redirected. OAuth/notification paths stay untouched. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try { if (new URL(path).hostname === 'expo-sharing') return '/capture'; } catch { /* Router also passes relative paths. */ }
  return path;
}
