# Explicit configuration-only production release

Local preparation only. No workflow, environment mutation or deployment was run.
The existing source release and NO_CHANGES defaults remain unchanged.

## Install the release support first

Review and approve this branch/PR, merge, and use the existing `deploy-now` source
release to publish the release-script change with the current environment.
Do not change Supabase routing during that bootstrap deployment. The new config
mode requires published SHA == current main == explicitly supplied expected SHA;
it cannot combine an unreviewed source update with a configuration change.

## One approved configuration deployment

1. Read current published ready production deployment ID and SHA. Preserve the
   exact old environment context values/absence privately. Confirm installed-client
   compatibility and the separately approved configuration scope.
2. Apply only the separately approved production environment delta. This workflow
   never edits environment variables, grants access or copies credentials.
3. Dispatch `production-release.yml` on main with:
   - `action=redeploy-config`
   - `expected_deploy_id=<current ready production ID>`
   - `expected_source_sha=<current published/main 40-character SHA>`
   - `config_change_ref=worklog-cutover-20261104` (example nonsecret approval reference)
4. The same existing concurrency group serializes source/config releases. A rerun
   attempt is rejected. The preflight, main refresh and publication refresh happen
   before the only build-hook POST. Build guard checks the expected baseline again.
5. Guard writes `public/.well-known/config-release.json` only after checks pass.
   It contains deployment ID, workflow run ID, previous deployment ID, source SHA
   and the nonsecret change reference, never environment values. Do not put private
   text or secrets in the change reference. This generated file is not committed.
6. Success requires a NEW ready production deployment ID, the expected SHA, a
   publication timestamp no earlier than issuance, and the matching receipt from
   its immutable Netlify deploy URL. Production is reread after receipt validation.
   The pre-existing ready deployment and an unrelated same-SHA deploy cannot pass.
7. Then verify the live public auth-config contract and actual client behavior.
   `PUBLISHED` attests deployment identity, not correct env values, login, saved
   data or notification delivery. Those remain explicit cutover acceptance checks.

## Failure and rollback

Observation makes at most 40 attempts, waits 15 seconds between attempts and uses
30-second request deadlines; the workflow has its existing 20-minute hard limit.
Timeout/cancellation/failed acknowledgement can leave publication uncertain.
Never infer unchanged production from a failed workflow. Inspect live deployment,
receipt and public config before deciding whether another action is needed.
There is no POST retry, automatic environment reversal, data rollback or deployment
rollback. An out-of-band deploy can still occur after the last observation.

For an approved configuration rollback: preserve any new target writes, restore
the previous environment values/absence, reread the NOW-current ready deployment
ID/SHA, and use a new explicit config-mode run with that fresh baseline and a
rollback reference. Reusing the original baseline fails closed. If main moved,
stop and review the source difference rather than bypassing the same-SHA guard.
Returning the endpoint to source does not copy target writes back to source.

