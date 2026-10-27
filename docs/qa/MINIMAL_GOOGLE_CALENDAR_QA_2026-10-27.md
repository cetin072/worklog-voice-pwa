# Minimal Google Calendar — approval-gated QA checkpoint

## Status (not full Calendar acceptance ready)

- Latest main bce6f8f retained; #470/#471 and their voice/reminder/edit/icon/update behavior retained.
- Existing Draft #466 f221836 reused without rewriting its branch. No active Calendar PR found; old #421 removal is preserved (no startup Calendar recovery, imports, device-calendar permission, or historical sync restored).
- New Calendar work is an isolated output branch. It is deliberately not added to the scope of package-boundary PR #466.
- QA variant `com.cetin072.worklog.qa`, version `0.1.0`, versionCode `5`; existing signing workflow reused. Production package/version/keys unchanged. Both apps may remain installed.
- This APK previews a selected confirmed schedule and explicitly says approval pending / not registered. It does NOT yet provide end-to-end Google creation. Do not announce full integrated Calendar QA ready.

## Implemented and independently testable

- Provider-neutral single-event exporter + Google REST adapter behind injection. No background job, schema, list/import, update/delete, or bidirectional sync.
- Deterministic event ID from the canonical Schedule UUID. Read same event before creation and after POST, including lost response/409 reconciliation. Double taps share a pending operation. Deleted/mismatched events block rather than silently recreate/overwrite. Restart and title edits retain the same event ID.
- Success requires GET evidence matching ID, confirmed status, and source Schedule UUID. Network/permission/missing response stays unknown. Cancel before execution does nothing; stale account never reports success. A change after dispatch cannot cancel an already committed remote write and remains unknown until rechecked.
- Explicit title, RFC3339 offset + IANA zone, and end required; all-day dates use an exclusive end. No guessed end time, attendees, or automatic Google reminders.
- Actual UI is a scrollable preview (small screen/large font), with no save-success assertion or implicit permission grant. Account selection and end-time confirmation UI belong to the authorization-enabled follow-up, not this checkpoint.
- The adapter is not connected to existing Google/Supabase login and does not fetch, create, persist, refresh, or register tokens. No actual Google request or user calendar mutation was executed.

## Authorization needed before live integration

User/delegation explicitly requires separate confirmation for new OAuth grants, token/secret registration, or expanded permissions. No such confirmation is present.

Proposed minimal route: explicit account choice and an incremental Calendar grant for an owned target calendar. `calendar.events.owned` allows read/create/change/delete on calendars the user owns, although this implementation only gets its own deterministic event and inserts one. The broader grant must be explained honestly. A narrower `calendar.app.created` alternative requires a new secondary calendar and changes the destination UX; do not silently substitute it. Native Calendar READ/WRITE would also expand permissions and local-save evidence would not prove Google server synchronization. Opening a compose URL cannot prove save or prevent duplicates reliably.

Before enabling real writes, approve:
1. The OAuth approach/scope and selected existing Cloud OAuth project; any consent-screen/client/callback changes or grant creation. Inspect metadata without printing credentials; do not assume current login includes Calendar scope.
2. The test Google account and exact owned calendar; permission to insert a small enumerated set of clearly synthetic events (timed and all-day). No existing events modified/deleted; cleanup requires explicit scope.
3. After approval, implement account-bound authorization, canonical re-read immediately before submission (current owner/status/revision/title/start/end/all-day), explicit target/end confirmation, and integration into the existing provider-neutral exporter. Never treat a briefing snapshot as sufficient final write authority.

No authorization request was executed or rejected; it is **pending user confirmation**, not a login bypass problem. Existing gh CLI authentication check failed once; use the connected GitHub tool for PR/actions reads rather than retrying credentials. Git fetch works.

Official sources checked 2026-10-27:
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/calendar/api/guides/create-events

## Verification and remaining device work

Local regression results and exact artifact details are recorded in the handoff. Isolated tests use synthetic data and injected HTTP; they are not evidence of Google account authorization or a real Google write. Tests cover title/offset/zone/all-day, cancel/unknown, duplicate click/relaunch, committed-write response loss, permissions/network errors, account mismatch, deletion/tombstone, preview close/back/scroll/wrapping.

The existing synthetic Android runtime smoke covers voice start/cancel and navigation. Home capture additionally opens the actual Calendar preview at widths 320/390 and 320 font scale 1.4. Synthetic APK is never the user install artifact. Exact-head native build/runtime evidence must pass before asking for phone QA.

Human QA after gates: QA co-installation, QA login/callback, voice record/save, canonical schedule creation, reminder delivery/permissions, edit persistence, icon distinction. Play update prompt eligibility must be tested on the production package from the approved Play track; the QA package is intentionally not that track. Google account selection/create/duplicate/offline acceptance stays blocked until authorized live integration exists.

## Independent CI failure repaired

#466 UAR40512516002 failed 1/974 at server-push.test.mjs:84 with WEB_PUSH_KEY_INPUT_INVALID. OpenSSL ECDH getPrivateKey can omit leading zero octets; generated one-time scalar was then rejected by the strict 32-byte derivation boundary. Left-pad only newly generated ephemeral scalar to 32 bytes. Installed VAPID key validation and actual secrets unchanged. Deterministic 1/31/32-byte synthetic generator regression plus RFC8291 vectors verify the correction. No operational web deployment performed.

## Next Codex/Work instruction

Continue Draft `feat/minimal-calendar-qa-20261027`, preserve #466 ancestry and latest main. Read this report and current PR first. Do not claim Calendar complete from the approval-gated preview. Obtain explicit OAuth scope/project and synthetic test-account/calendar approval, then implement the authorized account-bound adapter wiring and canonical re-read/end confirmation; test real insert/readback and same-ID retries only within that approved scope. Build exact-head normal QA APK with existing QA identity/signing, verify APK SHA/package/version and runtime captures, deliver raw APK through Library. Wait for user phone QA before any Play submission; existing Alpha update and public release are distinct. Do not change production web schedule, keys, terms, costs, or security settings.
