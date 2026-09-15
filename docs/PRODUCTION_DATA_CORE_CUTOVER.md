# Production Data Core Cutover

Status: **Preparation in progress. Production activation has not been performed.**

## Baseline

- Latest `main`: `434907101aed41efe7843d10b3d03ab7ff562e95` (PR #171 merged).
- Goal branch: `goal/production-data-core-cutover`; current baseline includes child PR #193 for Windows UAR browser-gate compatibility and Draft Final Gate PR #194.
- Production public runtime: `https://worklog-voice-pwa.netlify.app` returned `200` on 2026-09-15. `GET /api/supabase-auth-config` returned `configured=false` and `dataCorePrimaryEnabled=false`.
- The production worklog health endpoint returned `200` with `ok=true`, `configured=true`, and `mode=owner`.
- Supabase target: `worklog-platform` (`zlhdhwgabqzsuuhaiedc`). No other Supabase project is in scope.
- This runner has no Netlify or Supabase CLI credentials. Netlify environment inventory, remote migration history, and Advisor results below are preserved from the merged Platform V1 gate and must be re-read through the authorized operations console before activation.

## Current production Data Core state

The public production configuration proves that Supabase public configuration and the primary Data Core path are **OFF**. No Production environment variable was created or changed during this goal.

The required Production settings remain intentionally absent or disabled:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `WORKLOG_DATA_CORE_PRIMARY_ENABLED`
- `WORKLOG_DATA_CORE_BRIEFING_ENABLED`
- `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED`
- `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED`

`SUPABASE_SECRET_KEY` must not be set for this cutover. It is not a browser or public-function configuration value.

## Migration and security baseline

The merged Platform V1 gate recorded these repository/remote-aligned migrations, in order:

1. `20260914161008_personal_workspace_bootstrap`
2. `20260914161132_fix_personal_workspace_bootstrap_ambiguity`
3. `20260914161258_data_core_worklog_idempotency`
4. `20260914162801_confirm_schedule_candidate`
5. `20260915000923_data_core_usage_ledger_v1`
6. `20260915001501_shared_cost_allocation_v1`
7. `20260915001535_shared_cost_pool_explicit_deny_policy`
8. `20260915023455_restrict_work_record_mutations_to_creator`

The prior remote fixture used rollback and recorded: idempotent personal-workspace bootstrap, owner WorkRecord insert, same-workspace member read but no creator-owned update, outsider read/update denial, and idempotent ScheduleCandidate confirmation. It did not retain test users or rows.

The last recorded Supabase Security Advisor result was **0 blocking findings**. The Performance Advisor had only 11 `unused_index` INFO findings on new or low-use tables. Re-run both in `worklog-platform` before activation; do not mutate the remote migration history to make it appear aligned.

## Verification evidence

- `npm test` on the Goal baseline: **242 passed, 0 failed**.
- PR #171's GitHub User Acceptance Ready workflow: **success**.
- The exact Draft Final Gate Preview is `https://deploy-preview-194--worklog-voice-pwa.netlify.app` and is READY for PR head `9bbb5363f7bee4f508948b0b69abf4205e140dcf`.
- PR #194 GitHub User Acceptance Ready workflow passed. A direct re-run against that exact Preview passed UI contract, environment parity, Preview runtime, representative smoke, and mobile visual stability. The public auth config passed the Data Core contract with no secret field; browser gates blocked external writes.
- Issue #192 / child PR #193 fixed Windows Chrome discovery in the browser gates while preserving the Linux lookup.
- The existing codebase retains `setup.html`, personal Notion-token handling, Notion worklog adapter behavior, existing Quick Worklog, Briefing fallback, and access-key paths. Contract tests cover Notion adapter behavior and a Data Core primary save with no Notion configuration.

## Notion-free and Notion compatibility acceptance

The test and Preview evidence proves the app shell and no-Notion Data Core contract, but it is not a live authenticated write E2E. A prior synthetic signup was rejected before account creation. This runner cannot safely create a deliverable disposable mailbox or access the authorized Supabase console, so the following remain an explicit pre-activation operational check using an approved disposable account:

1. Sign up and log in with no Notion connection.
2. Confirm one Personal Workspace and one owner membership.
3. Save a WorkRecord, repeat the same request, then confirm one canonical SourceRef/WorkRecord result.
4. Read Briefing, mark complete, undo, and read Schedule.
5. Run a separate existing-Notion-user smoke and verify the fallback/compatibility path.
6. Clean up the approved QA account and fixture data using the approved console process.

Do not weaken email-confirmation or Auth policy merely to make this test easier.

## Activation plan — explicit approval required

After the final Gate PR is approved and merged, activate only in this order in Netlify Production:

1. Set `SUPABASE_URL` to the `worklog-platform` URL.
2. Set `SUPABASE_PUBLISHABLE_KEY`.
3. Set `WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`.
4. Set `WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`.
5. Set `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED=true`.
6. Set `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED=true`.

Never add a service-role key, `SUPABASE_SECRET_KEY`, paid STT/AI provider secret, or privileged credential to the client/public configuration.

## Production activation smoke plan

Use only an approved test account after each configuration change is live:

1. `GET /api/supabase-auth-config` must report `configured=true`, `dataCorePrimaryEnabled=true`, an HTTPS Supabase origin, and no secret/service-role field.
2. Log in, save a WorkRecord, and repeat the same request to prove idempotency.
3. Read Briefing; complete and undo one record; verify Schedule.
4. Verify an existing Notion user's worklog and Briefing compatibility path.
5. Check function logs only for sanitized operational outcomes; never paste credentials into logs, issues, or PRs.

## Rollback

If a cutover symptom appears, first set these flags to `false` in reverse order:

1. `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED`
2. `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED`
3. `WORKLOG_DATA_CORE_BRIEFING_ENABLED`
4. `WORKLOG_DATA_CORE_PRIMARY_ENABLED`

Confirm the existing Notion path remains usable. Do not delete Supabase rows, drop schema, or roll back migrations as the first response. Feature-flag rollback is expected to be a configuration propagation interval plus smoke verification; record the observed propagation time during the approved activation.

## Final approval checklist

- [x] Latest `main` baseline captured.
- [x] Full repository tests pass.
- [x] Exact Final Gate Preview runtime, parity, UI, smoke, and visual checks pass.
- [x] Public Production endpoint confirms Data Core is OFF.
- [x] Notion compatibility code/contract regression reviewed.
- [x] Migration, RLS, Advisor, secret-boundary evidence recorded from the merged Platform V1 gate.
- [x] Rollback and activation-smoke plans documented.
- [ ] Re-read Netlify Production environment inventory and `worklog-platform` migration/Advisor state using authorized operations access immediately before activation.
- [ ] Execute and clean up approved disposable-account Notion-free E2E and existing-Notion-user live smoke.
- [x] Final Goal-to-`main` Draft Gate PR created: #194.
- [ ] User approval for Goal-to-`main` merge.
- [ ] Separate user approval for Production flag activation.

## Approval boundary

Do not activate Production Data Core, merge this goal to `main`, set privileged Production secrets, remove Notion behavior, execute destructive migration/data changes, or enable paid providers without explicit user approval.
