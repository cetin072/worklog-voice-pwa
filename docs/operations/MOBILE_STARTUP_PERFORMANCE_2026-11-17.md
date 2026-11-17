# Mobile startup: account-safe notification preservation

Status: Draft PR, no merge/deployment/DB/APK/Play changes. Base main is `db25350c18aa73d10a3b0d15b52c8b733b94a817`; #547 is merged. #548 remains a separate Draft and its feature/UI is not copied or replaced. No `.agents/skills` exists in this checkout or workspace; repository AGENTS.md, architecture principles and the central web standard were reviewed.

## Findings and implementation

This is a measured improvement to the current path, **not proof of a recent regression**. The account gate already existed in the November 10 QA version. Historical #537 first-touch timings came from different CI runs and are not a baseline here.

- `mobile/src/providers/platform-provider.tsx`: configuration and initial URL lookup run together. Session and server getUser checks have the existing 15-second request deadline. The SDK does not accept the wrapper's AbortSignal, so this bounds waiting/publication, not necessarily the underlying transport. An expired attempt cannot later publish. The auth listener is installed before awaiting verification, so logout/account replacement during boot supersedes the initial session.
- `mobile/src/platform/local-account-gate.ts`: cleanup/preparation and server identity verification overlap; both settle before publication. A stale epoch cannot confirm ownership or publish. Verification failure clears even same-account retained alarms before reporting failure. Cleanup failure never grants access. Auth callbacks still defer work outside the Supabase listener lock.
- `mobile/src/features/schedule/schedule-reminder-service.ts`: an optional `accountScope` in the existing encrypted v3 state contains project URL, data schema and user ID. Only successful server verification followed by guarded confirmation establishes it. Same-scope restart also checks the OS snapshot against stored reservation contents. Missing proof, account/project change, interrupted intents, unknown/mismatched alarms still take cleanup. Corrupt state fails closed. The marker is removed in the durable cancellation journal before OS mutation; cancellation failures/crashes retain all IDs for retry. Cleanup uses one initial and one final OS snapshot, instead of repeating storage/list operations for every schedule and all six offsets. It never calls global cancel-all or touches unrelated notifications/server data. Existing offset/title/time values are unchanged on a proved same-account restart.
- The first startup after upgrading an older state has **no owner proof and still cleans up**. Existing canonical recovery is retained; this PR does not infer ownership of legacy local settings or silently claim their custom offsets can be recovered. Once provenance is established, future same-account restarts preserve those settings. Explicit logout/login and invalid identity still clear local reservations, as before.
- `mobile/app/index.tsx`: background reminder recovery and initial briefing now follow client/account lifetime, avoiding duplicate recovery and reads on a same-owner token rotation. Auth events still invalidate work on actual owner changes/logout. `setBriefing(next)` remains **before** awaiting reminder recovery; recovery was not the full first-render gate. Foreground/manual refresh and offline calendar retry remain intact.
- `mobile/src/features/recurring/use-repeating-work.ts`: an unchanged read retains the prior snapshot identity, avoiding an unnecessary native reminder synchronization. Newer locally confirmed versions still win over slow reads.
- `mobile/src/features/startup/startup-timing.ts`: opt-in `EXPO_PUBLIC_STARTUP_TIMING=1` logs fixed stages and duration/outcome only. Config, session, identity, notification preparation, account gate, briefing, recovery, recurring read, month calendar and Google read are instrumented. No account/project IDs, URL, token, work text, payload or error text enters this diagnostic. These are stage execution timings, not screen paint/touch measurements; recovery has its existing internal error handling. No analytics service or persisted telemetry was added.
- Month-calendar and Google queries still serve the currently visible date range and keep their current owner/range stale-response guards. No speculative cross-account cache or stale result is used to declare startup ready. Broader query/window reduction is deferred because the current UI requires these records; new timings allow a device run to identify whether these stages warrant more work. No whole-app UI rewrite.

## Reproducible synthetic comparison

Run `node scripts/benchmarks/mobile-startup.mjs db25350c18aa73d10a3b0d15b52c8b733b94a817` from the repository root. It loads the actual before/after gate and reminder service; both use the current unchanged durable storage implementation. All storage and native drivers are in-memory mocks, no network or real credentials. Node v24.19.0, 12 synthetic schedules with 5/30/1440-minute custom offsets, 1 ms per low-level storage/native operation, 40 ms identity response, five sequential samples per case. Seed/setup is excluded. Metric: **account gate transition only**, not app startup or first touch. Fixed simulated latencies are explanatory fixtures, not Android latency estimates. Raw samples: [JSON evidence](evidence/mobile-startup-2026-11-17.json).

| Scenario | Before median | After median | OS lists before → after | OS cancels before → after |
|---|---:|---:|---:|---:|
| Same proved account/project | 893 ms | 44 ms | 98 → 1 | 12 → 0 |
| Owner proof absent | 879 ms | 81 ms | 98 → 2 | 12 → 12 |
| Different account | 887 ms | 81 ms | 98 → 2 | 12 → 12 |

Same-account low-level storage reads/writes: 481/157 → 6/0. Required-cleanup cases: 481/157 → 40/19. Before leaves zero reservations; after same-account retains all 12, including custom offsets. The benchmark ends at publication and does not count later canonical recovery, so it does not claim an end-to-end regeneration saving or real user time reduction.

## Validation

- Runtime regressions execute the production gate, reminder service, durable storage, actual provider and Home/recurring hooks with mocked external boundaries. Covered: project/account isolation, missing proof, unchanged custom offsets, logout, offline/mismatched identity, timeout and late success, superseded verification, disposal, stale confirmation, crash after journal acknowledgement/cancellation, cancellation failure/no-op, retry, orphan/mismatched/foreign reservations, unchanged recurring reads, token refresh vs logout invalidation, delayed recovery vs first briefing, calendar/Google stale responses, privacy-safe timing.
- TypeScript: PASS after regenerating stale workspace-only Expo Router types with offline Expo start. Initial errors concerned existing capture routes missing from `.expo/types/router.d.ts`; no source suppression was added.
- Android Metro/Hermes export: PASS; build artifact is local and not an APK or deployment.
- Complete `npm test`: **1,373 PASS, 0 FAIL**, 51.5 seconds in the final local run.
- `git diff --check`: PASS.

## Limits / release follow-up

No adb/emulator/Android SDK or connected physical device was available, so Android runtime/touch latency, native SecureStore/notification crash behavior and real authenticated server latency remain unmeasured. Metro/Hermes export and Node native mocks are not device evidence. No actual user data, production DB, production environment, OAuth configuration or release channel was modified. No speed percentage for users is claimed.

Before an authorized merge/release: inspect account-isolation/notification journaling changes, run the stable candidate on Android with startup timing enabled, verify warm restart/custom offsets plus logout/account switch/offline/retry on isolated accounts, and review interaction with #548 if it merges first. Patch notes are intentionally left for merge because this change is not shipped.
