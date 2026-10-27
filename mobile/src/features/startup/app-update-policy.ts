// One check per JS runtime, shared across remounts. A fresh app launch checks again.
export function createUpdateSession(check: () => Promise<boolean>, timeoutMs = 5000) {
  let pending: Promise<boolean> | undefined;
  let dismissed = false;
  return {
    check() {
      if (!pending) pending = new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        Promise.resolve().then(check).then(value => resolve(value === true), () => resolve(false))
          .finally(() => clearTimeout(timer));
      });
      return pending;
    },
    dismiss() { dismissed = true; },
    isDismissed() { return dismissed; },
  };
}

// Only reached after the installed production package's Play query confirms availability.
export async function openUpdateStore(openURL: (url: string) => Promise<unknown>) {
  try { await openURL('market://details?id=com.cetin072.worklog'); }
  catch { await openURL('https://play.google.com/store/apps/details?id=com.cetin072.worklog'); }
}
