-- Issue #385 / Stage 4-0: move notification scheduler RPCs behind a server-only service_role gateway.
-- Existing scheduler-secret validation remains inside each RPC. This migration only tightens who may invoke them.

revoke all on function public.claim_morning_notification_deliveries(text, text, date)
  from public, anon, authenticated;
grant execute on function public.claim_morning_notification_deliveries(text, text, date)
  to service_role;

revoke all on function public.claim_afternoon_notification_deliveries(text, text, date)
  from public, anon, authenticated;
grant execute on function public.claim_afternoon_notification_deliveries(text, text, date)
  to service_role;

revoke all on function public.finish_notification_delivery(text, uuid, boolean, integer, text)
  from public, anon, authenticated;
grant execute on function public.finish_notification_delivery(text, uuid, boolean, integer, text)
  to service_role;
