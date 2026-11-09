/** Account publication waits for device cleanup + server identity verification.
 * The callback is deferred, avoiding Supabase auth-listener lock reentrancy. */
export function createLocalAccountGate<T extends { user: { id: string } }>(deps: {
  clear(): Promise<unknown>; verify(id: string): Promise<boolean>;
  owner(id: string | null): void; publish(session: T | null): void; failed(): void;
}) {
  let epoch = 0;
  let published: string | null = null;
  return {
    async transition(session: T | null) {
      const ticket = ++epoch;
      published = null;
      deps.owner(null);
      deps.publish(null);
      // Auth listener must return before calling getUser or other auth methods.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      try {
        await deps.clear();
        if (ticket !== epoch) return;
        if (session && !await deps.verify(session.user.id)) throw Error('LOCAL_ACCOUNT_UNVERIFIED');
        if (ticket !== epoch) return;
        deps.owner(session?.user.id || null);
        published = session?.user.id || null;
        deps.publish(session);
      } catch {
        if (ticket === epoch) deps.failed();
      }
    },
    current() { return published; },
    dispose() { epoch++; published = null; deps.owner(null); },
  };
}
