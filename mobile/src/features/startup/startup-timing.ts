/** Fixed stage names only: never log IDs, URLs, tokens, payloads or errors. */
type Stage = 'config' | 'session' | 'identity' | 'notifications' | 'account' | 'briefing' | 'recovery' | 'recurring' | 'calendar' | 'google';
export type StartupTiming = { stage: Stage; durationMs: number; outcome: 'ok' | 'error' };
export async function measureStartup<T>(stage: Stage, run: () => Promise<T>,
  emit: (event: StartupTiming) => void = event => {
    if (process.env.EXPO_PUBLIC_STARTUP_TIMING === '1') console.info('[startup-timing]', event);
  }, now: () => number = () => performance.now()): Promise<T> {
  const started = now();
  let outcome: StartupTiming['outcome'] = 'error';
  try { const value = await run(); outcome = 'ok'; return value; }
  finally { try { emit({ stage, durationMs: Math.max(0, Math.round(now() - started)), outcome }); } catch { /* diagnostics cannot break startup */ } }
}
