export function notificationResponseHandler<T>(isActive: () => boolean, open: (response: T) => boolean, clear: () => Promise<void>) {
  return async (response: T | null) => {
    if (!response || !isActive()) return;
    if (open(response) && isActive()) await clear();
  };
}
