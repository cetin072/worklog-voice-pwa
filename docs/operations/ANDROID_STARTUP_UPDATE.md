# Android startup update prompt (Draft)

## Scope and reference

Base: Worklog main `056a6339f4352e92c4a023ebd05dddeb7c9bc201`.
Read-only reference: Taejang main `dec4ca7e77f32267ee37a99d3865cf7efd66117c`,
`mobile/src/platform/update-lifecycle.tsx` and `release-policy.ts` (latest actual code,
not an assumption based on historical PR #492).

Reused behavior: optional later/update actions, Android back dismissal, accessible
scrollable dialog, in-session dismissal, market URI followed by HTTPS fallback.
Taejang's server version policy, forced update, maintenance, remote release notes,
branding, package identifiers and authentication dependencies are not copied.

Worklog requires actual installed-user eligibility. A small Android-only local Expo
module uses Google's official `com.google.android.play:app-update:2.1.0` SDK and
returns true only for `UpdateAvailability.UPDATE_AVAILABLE`. No GitHub, AAB,
manifest version comparison or release-policy server can assert availability.
The native package must be `com.cetin072.worklog`; QA packages remain silent.
No update flow/install API is called. The user's explicit action only opens Play.

Official references checked 2026-10-27:
- https://developer.android.com/guide/playcore/in-app-updates/kotlin-java
- https://docs.expo.dev/modules/get-started/

The existing Expo runtime auto-links the local module under `mobile/modules`.
No third-party RN update wrapper, server, credentials or paid service is added.
Google Play SDK is Google's distributed Android SDK, subject to its SDK terms
(https://developer.android.com/guide/playcore#license), not represented as MIT.
It requires a native rebuild; Metro-only or an older installed binary cannot expose
this module. Missing module, unsupported platform, SDK failure and a 5-second
check timeout all remain silent. The app shell and brand loading never await it.
There is no background worker, push registration, permission or install change.

## Session choice

One check per JS runtime, cached through remounts/resumes (including failed checks).
The dialog is visible only while the app is active. Later/back and successful
store opening dismiss it for this runtime; returning from Play does not re-prompt.
A cold relaunch checks again. Unlike Taejang, resume does not refresh remote policy.
This deliberately avoids repeated prompts or repeated offline checks in a session.
Store opening failure leaves Later available and displays a retry message.

## Icon status and isolated QA work

Approved source identified by the parent from the 2026-10-24 conversation:
`worklog-launcher-1024.png` and `worklog-qa-launcher-1024.png` (both 1024×1024).
The supported Library transfer failed before local bytes were obtained. Pixels,
transparency and safe-zone masks therefore remain unverified. No substitute or
placeholder was registered, and no store listing assets were changed.

QA #469 remains separate. Remote branch `qa/home-ux-prehuman-20261027` still points
to `185f13fe53dac2ec14cee6aa660ea5a1c6c2e676`; its PR/check status could not be read
because GitHub GraphQL returned Forbidden. No QA packaging changes are included.
The submitted Alpha/code3 review and production release are outside this change.

## Validation and remaining gate

- TypeScript passed.
- Runtime mocks cover available/unavailable, concurrent check, session dismissal,
  fresh-runtime relaunch, offline/rejected/synchronous failure, malformed result,
  timeout/late result, market success, HTTPS fallback and both handlers failing.
- Full root test suite: 954 passed, 0 failed.
- Expo autolinking resolves WorklogPlayUpdateModule; Android prebuild passed.
- Android Metro/Hermes export passed (1481 modules).
- Native Kotlin compile could not start: Gradle distribution download failed with
  `UnknownHostException: services.gradle.org`; no Android SDK path was configured.
- Actual Play-installed account/track/device eligibility, native runtime smoke,
  TalkBack/back-button interaction and icon resources still require verification.
- No production user update is claimed to be available by this implementation report.

Before approval/merge: finish native compilation and exact-head CI, register and
inspect the approved icon assets once accessible, then run Play-installed device
checks with an eligible newer release and an ineligible/current track. Offline and
Later must preserve login, home, recordings and scheduled reminders. Do not submit
or release an AAB, alter signing/package IDs, merge #469, or deploy the web.
Patch notes are intentionally deferred until merge per repository policy.
