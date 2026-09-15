# Production Data Core Activation — 2026-09-15

Status: **Activation approved and Production public configuration applied; fresh Production deploy required before runtime smoke.**

## Approval

The user explicitly approved continuing from the merged Production cutover-readiness gate into Production Data Core activation.

## Baseline

- `main` before this activation record: `ac241f8697d2355cc74a6640b437f697c323f74b` (PR #194 merged)
- Supabase project: `worklog-platform` (`zlhdhwgabqzsuuhaiedc`)
- Existing Notion compatibility path remains in place
- No destructive database change is part of this activation

## Production environment applied

The following public/non-privileged Netlify Production settings were added:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`
- `WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`
- `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED=true`
- `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED=true`

`SUPABASE_SECRET_KEY` was not added. No service-role credential or paid STT/AI provider secret was added.

## Runtime state before fresh deploy

The existing Production deploy predates the environment-variable change. A live runtime check therefore still returned `configured=false` and `dataCorePrimaryEnabled=false` before the fresh deploy. This is expected and proves the environment change did not silently alter the already-published deploy.

## Fresh deploy and smoke gate

After this documentation-only activation record is merged to `main`, Netlify should create a fresh Production deploy from the current `main` code with the approved Production environment.

The activation is considered complete only after the fresh deploy passes:

1. `/api/supabase-auth-config` reports `configured=true` and `dataCorePrimaryEnabled=true` with no privileged-secret field.
2. Controlled QA Auth login succeeds.
3. Personal Workspace / owner membership exists exactly once.
4. WorkRecord save succeeds without requiring Notion.
5. Repeating the same `clientRequestId` dedupes to the same WorkRecord.
6. Briefing read succeeds.
7. Complete and undo mutations succeed.
8. Schedule is visible in Briefing.
9. Existing Notion read compatibility remains healthy.
10. QA account and all QA fixtures are removed after PASS.

## Rollback

If the Production smoke fails, disable the Data Core flags in reverse order, preserving Supabase data and the existing Notion path:

1. `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED=false`
2. `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED=false`
3. `WORKLOG_DATA_CORE_BRIEFING_ENABLED=false`
4. `WORKLOG_DATA_CORE_PRIMARY_ENABLED=false`

Do not drop schema or delete Production user data as the first rollback action.
