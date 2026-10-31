// Legacy PWA Web Push is retired. No schedule or delivery is registered.
// Keep a harmless endpoint to prevent an old manual invocation from sending a notification.
export default async () => new Response(null, { status: 204 });
