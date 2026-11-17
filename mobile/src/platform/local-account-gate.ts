/** Account publication waits for device cleanup + server identity verification.
 * The callback is deferred, avoiding Supabase auth-listener lock reentrancy. */
export function createLocalAccountGate<T extends { user: { id: string } }>(deps: {
  clear(session?: T | null): Promise<unknown>; verify(id: string): Promise<boolean>;
  reject?(session: T): Promise<unknown>;
  confirm?(session: T, current: () => boolean): Promise<unknown>;
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
      if (ticket !== epoch) return;
      try {
        // Both must finish before publication. allSettled prevents late cleanup
        // from running behind a retry after the identity request fails early.
        const [cleanup, identity] = await Promise.allSettled([
          deps.clear(session), session ? deps.verify(session.user.id) : Promise.resolve(true),
        ]);
        if (ticket !== epoch) return;
        if (cleanup.status === 'rejected') throw cleanup.reason;
        if (identity.status === 'rejected' || !identity.value) {
          if (session && deps.reject) await deps.reject(session);
          else await deps.clear(null);
          throw Error('LOCAL_ACCOUNT_UNVERIFIED');
        }
        if (session) await deps.confirm?.(session, () => ticket === epoch);
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
