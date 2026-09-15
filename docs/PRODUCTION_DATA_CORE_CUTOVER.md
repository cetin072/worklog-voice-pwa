# Production Data Core Cutover

Status: **Cutover readiness verified. Production activation has not been performed.**

## Baseline

- Latest `main`: `434907101aed41efe7843d10b3d03ab7ff562e95` (PR #171 merged).
- Goal branch: `goal/production-data-core-cutover`; Final Gate PR: #194.
- Goal remains based on latest `main` with `behind 0` at the final evidence refresh.
- Production public runtime: `https://worklog-voice-pwa.netlify.app` returned `200` on 2026-09-15. `GET /api/supabase-auth-config` returned `configured=false` and `dataCorePrimaryEnabled=false`.
- The production worklog health endpoint returned `200` with `ok=true`, `configured=true`, and `mode=owner`.
- Supabase target: `worklog-platform` (`zlhdhwgabqzsuuhaiedc`). No other Supabase project is in scope.

## Current Production Data Core state

Production Data Core is intentionally **OFF**. Authorized Netlify environment inventory was re-read immediately before this evidence refresh.

The following settings exist only in `deploy-preview`, not Production:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`
- `WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`
- `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED=true`
- `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED=true`

No Production Data Core setting was created or changed during this gate. `SUPABASE_SECRET_KEY` is not part of this cutover and must not be added to client/public configuration.

## Migration and security baseline

Authorized operations access re-read the remote migration history from `worklog-platform`; it matches these eight migrations in order:

1. `20260914161008_personal_workspace_bootstrap`
2. `20260914161132_fix_personal_workspace_bootstrap_ambiguity`
3. `20260914161258_data_core_worklog_idempotency`
4. `20260914162801_confirm_schedule_candidate`
5. `20260915000923_data_core_usage_ledger_v1`
6. `20260915001501_shared_cost_allocation_v1`
7. `20260915001535_shared_cost_pool_explicit_deny_policy`
8. `20260915023455_restrict_work_record_mutations_to_creator`

The remote RLS fixture evidence remains valid: idempotent Personal Workspace bootstrap, owner WorkRecord insert, same-workspace member read but no creator-owned update, outsider read/update denial, and idempotent ScheduleCandidate confirmation.

Supabase Advisor was re-run on `worklog-platform`:

- Security Advisor: **0 findings**.
- Performance Advisor: **11 `unused_index` INFO findings only** on new/low-use indexes; no blocking performance/security finding.

Remote migration history was not rewritten or manipulated.

## Verification evidence

- `npm test`: **242 passed, 0 failed** on the cutover goal baseline.
- PR #194 User Acceptance Ready workflow: **PASS** before the final evidence-only refresh.
- Exact Final Gate Preview: `https://deploy-preview-194--worklog-voice-pwa.netlify.app`.
- UI contract, environment parity, Preview runtime, representative smoke, and mobile visual stability: **PASS**.
- Preview public auth config exposes only public Supabase configuration and feature state; no server secret/service-role field is exposed.
- Issue #192 / child PR #193 fixed Windows Chrome discovery in browser gates while preserving Linux discovery.
- Final exact-head UAR and Deploy Preview must be green again after this documentation refresh before PR #194 is marked Ready for Review.

## Live authenticated Notion-free acceptance

A controlled disposable QA Auth user was created only in the correct `worklog-platform` project, then authenticated through the real Supabase password-login endpoint. No Production Data Core flag was enabled.

GitHub Actions temporary live E2E run `34946706528`, attempt 2, executed against PR #194 Deploy Preview and the real `worklog-platform` Data Core. It passed all of the following:

- public Preview Data Core configuration available
- real password login and access token issuance
- exactly one Personal Workspace
- exactly one owner membership
- authenticated Schedule insert
- authenticated `/api/worklog` Data Core health
- Notion-free WorkRecord save
- repeated identical `clientRequestId` returned the same WorkRecord
- SourceRef/WorkRecord idempotent path
- Data Core Briefing read
- Schedule visible in Briefing
- WorkRecord `완료` mutation
- completed WorkRecord removed from open Briefing
- `진행중` undo mutation
- WorkRecord returned to open Briefing

The public self-signup attempt used a non-deliverable disposable domain and was rejected by Supabase email validation before account creation. Auth/email-confirmation policy was **not weakened**. The controlled QA-user path was used only to exercise actual password authentication and authenticated RLS/API behavior.

After PASS, the QA user's WorkRecord, SourceRef, Schedule, membership, workspace, Auth sessions/refresh tokens/identity/user were removed. A final cleanup query confirmed **0 residual user/workspace/work-record/source-ref/schedule rows** for the QA user. Temporary QA workflow/script files were also removed from the goal branch.

## Existing Notion compatibility acceptance

The existing codebase still retains:

- `setup.html`
- personal Notion-token handling
- owner Notion configuration path
- Notion Worklog adapter
- existing Quick Worklog compatibility
- Briefing fallback
- access-key path

Contract tests cover the Notion adapter/write behavior and Data Core primary save without Notion.

A live **read-only** smoke was also performed against the connected existing Notion workspace. The `🎙 업무 통합 기록` area was reachable and returned its existing system briefing and multiple existing work-record pages. This proves the existing Notion content path is live and accessible. No real-user Notion record was created, edited, completed, or deleted during the gate; a destructive or unnecessary live write was intentionally avoided. Production owner worklog health remained available while Data Core stayed OFF.

## Activation plan — explicit approval required

After Final Gate PR #194 is approved and merged, activate only with a separate explicit user approval, in this order in Netlify Production:

1. Set `SUPABASE_URL` to the `worklog-platform` URL.
2. Set `SUPABASE_PUBLISHABLE_KEY`.
3. Set `WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`.
4. Set `WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`.
5. Set `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED=true`.
6. Set `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED=true`.

Never add a service-role key, `SUPABASE_SECRET_KEY`, paid STT/AI provider secret, or privileged credential to client/public configuration.

## Production activation smoke plan

Use only an approved test account after the configuration is live:

1. `GET /api/supabase-auth-config` must report `configured=true`, `dataCorePrimaryEnabled=true`, an HTTPS Supabase origin, and no secret/service-role field.
2. Log in, save a WorkRecord, and repeat the same request to prove idempotency.
3. Read Briefing; complete and undo one record; verify Schedule.
4. Verify the existing Notion compatibility/read path remains healthy.
5. Check function logs only for sanitized operational outcomes; never paste credentials into logs, issues, or PRs.

## Rollback

If a cutover symptom appears, first set these flags to `false` in reverse order:

1. `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED`
2. `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED`
3. `WORKLOG_DATA_CORE_BRIEFING_ENABLED`
4. `WORKLOG_DATA_CORE_PRIMARY_ENABLED`

Confirm the existing Notion path remains usable. Do not delete Supabase rows, drop schema, or roll back migrations as the first response. Feature-flag rollback is preferred; preserve user data.

## Final approval checklist

- [x] Latest `main` baseline captured and goal `behind 0`.
- [x] Full repository tests pass: 242/242.
- [x] Final Gate Preview runtime, parity, UI, smoke, and visual checks pass.
- [x] Public Production endpoint confirms Data Core is OFF.
- [x] Netlify Production/deploy-preview environment inventory re-read through authorized operations access.
- [x] `worklog-platform` remote migration history re-read and aligned.
- [x] Supabase Security Advisor re-run: 0 findings.
- [x] Performance Advisor re-run: only 11 unused-index INFO findings.
- [x] Live authenticated Notion-free E2E passed on real Data Core.
- [x] QA Auth account and all QA fixture data cleaned up; no residue.
- [x] Existing Notion workspace/content live read-only smoke passed.
- [x] Notion compatibility code/contract regression reviewed.
- [x] RLS and secret-boundary evidence verified.
- [x] Rollback and activation-smoke plans documented.
- [x] Final Goal-to-`main` Gate PR created: #194.
- [ ] Final exact-head UAR/Deploy Preview green after this evidence refresh.
- [ ] User approval for #194 Goal-to-`main` merge.
- [ ] Separate user approval for Production Data Core activation.

## Approval boundary

Do not activate Production Data Core, merge this goal to `main`, set privileged Production secrets, remove Notion behavior, execute destructive migration/data changes, or enable paid providers without explicit user approval.
