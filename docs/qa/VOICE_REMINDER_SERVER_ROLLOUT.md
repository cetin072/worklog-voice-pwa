# Voice reminder server change — review only

This PR targets main and contains only the reminder intent classifier, its tests,
the two-function SQL draft, an isolated SQL test, and this rollout/rollback plan.
It does not include the QA package, native permissions, voice runtime, icons, or
mobile UI changes from PR #462. That QA PR remains separate and unchanged.

## Readiness

- Code and isolated tests can be reviewed independently of deployment.
- SQL remains in `supabase/drafts`: it is NOT a deployable migration.
- AGENTS.md requires a branch/PR for RPC changes but does not mandate a CLI.
  The applicable Supabase skill requires generating the migration with
  `supabase migration new`; the pinned official CLI installation currently fails
  with a DNS resolution error. No executable migration filename is invented.
- Formal migration generation/validation and backup/recovery prerequisites remain
  gates. This document contains no private operational catalog or backup details.
- No production SQL, main merge, deployment, or Play submission is part of this PR.

## SQL scope

`confirm_my_worklog_reminder(uuid,timestamptz)` is SECURITY INVOKER and checks the
caller owns the personal work record before locking it. It creates at most one
linked reminder, preserves the record's content/kind/deadline, rejects inactive
records and past times, returns the existing schedule for a same-time retry, and
rejects conflicting times. The JSON metadata uses `reminderWorkRecordId`, separate
from the existing meeting/deadline association.

`cancel_my_work_record(uuid)` retains its signature and behavior but takes the
same record lock before schedule cancellation and includes the new association.
No table/column, RLS policy, key, account, or general role expansion is proposed.
The new function's EXECUTE grant is restricted to authenticated users; existing
function permissions are retained. Authorization still occurs inside the RPC.

## Forward sequence — only after prerequisites pass

1. Generate a formal migration with the supported CLI and place the reviewed SQL
   into it. Recheck the exact target function definitions/ACLs and migration state.
2. Confirm recoverable backup evidence and a usable restoration procedure.
   Function definitions alone are not a data backup. Do not restore production
   merely to test this gate, and do not substitute another project's evidence.
3. Rehearse against the current relevant schema/dependencies without production
   rows. Verify existing-function replacement, ownership, retries, conflicting
   times, cancellation races, privilege behavior and rollback preservation.
4. Report the exact main-target PR scope before any merge. Do not retarget or merge
   the whole QA branch as a substitute. Apply only the approved two-function
   migration after final readback checks; verify definitions/ACLs and history.
5. Release the server classifier through the existing 48-hour main-based
   Production gate. No manual forced deployment, hook replay, or gate changes.
6. Use the separately reviewed QA app and verify record/schedule/device reservation
   separately. Normal APK, installed certificate/data preservation, device alert,
   and reboot delivery are distinct checks. A JS bundle is not an install build.

## Mixed versions

- New app / old DB: explicit record reminder confirmation reports server preparation
  needed; do not create a native-only substitute or retry via direct inserts.
- New DB / old app: the additive RPC is unused; existing cancellation remains valid.
- New app / old classifier: expanded automatic intent recognition is not yet active.
- A missing or partial server response never authorizes inferred schedule deletion.

## Preserving rollback

Before use, prepare the exact previous classifier release reference and RPC DDL/ACL
baseline in the approved private operational evidence location, not this repository.
Prefer a forward fix for the deletion hook once new reminder associations exist.

To stop new explicit reminder creation while preserving existing data, the bounded
rollback is to disable the new authenticated RPC entrypoint:

```sql
REVOKE EXECUTE ON FUNCTION public.confirm_my_worklog_reminder(uuid,timestamptz)
FROM authenticated, PUBLIC, anon;
```

This is a reviewed rollback plan, NOT an instruction to execute now. It intentionally
leaves existing schedules and records intact. Keep the extended cancel function so
subsequent user cancellations still remove all linked reminders. Do not restore the
old cancellation function while new associations exist; it could leave active orphan
reminders. Do not drop tables, bulk-delete schedules, change record kinds/deadlines,
or blindly restore the entire database as part of this bounded rollback.

An app/server rollback also leaves already-created schedules intact; device cleanup
must still consume explicit canonical cancellation state. Re-enabling the RPC needs
a validated forward fix and rechecked privileges, not an unconditional grant replay.

## Local validation

- `node --test tests/reminder-intent-expansion.test.mjs`
- `npm test`
- `python3 scripts/test-worklog-reminder-postgres.py` with its pinned PostgreSQL image

The SQL test uses a network-isolated disposable container, stub auth identities and
repository schema fixture. The existing cancellation function is installed first,
then replaced while checking its EXECUTE ACL remains unchanged. The container uses
`--pull=never` and requires the pinned image to be available beforehand. It tests preservation after RPC execution is revoked,
continued record cancellation, and both confirm/cancel lock orders. It is not proof
of a production backup, full Supabase restore, native APK, or physical phone success.
