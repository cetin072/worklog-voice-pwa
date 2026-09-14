-- Supabase project security baseline.
-- New projects may install public.rls_auto_enable() for automatic RLS.
-- The event trigger needs the function, but app roles do not need direct RPC access.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
