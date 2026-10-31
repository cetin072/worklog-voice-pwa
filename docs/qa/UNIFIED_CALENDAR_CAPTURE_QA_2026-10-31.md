# Calendar + capture unified QA

QA-only integration of Calendar PR #474 and capture/gallery PR #473. It is not a production merge and does not replace either product PR.

- Main preserved: 9aed364fa0f79b3353b6f7cb629637147b835141 (deployed edit-loading metadata fallback and web Push retirement).
- Calendar source: f1213172e6f5d5a66d3dbf4135affdf2a8811b72 plus 43fb4e069fcf5f0332d2d38e8411d6bd6bdcdf75 (input validation, compact action, linked record action).
- Capture source: 881f0833a7c7b6da863ba1861202a1b2218abcaf, including Home gallery import, image share, Korean OCR, result refresh and editing.
- QA identity com.cetin072.worklog.qa, version 0.1.0 (9). Same QA signer; production app coexists.
- Branch qa/calendar-capture-20261031 uses the existing Mobile gate on push. Main/production deployment policy is unchanged. No new product PR or production migration is introduced.

## Confirmed defects and fixes

The screenshot reports Google connected successfully. A visible end equal to the start could enable Send, then fail validation inside a broad source-read catch. Validate before reads, show a precise inline end error, and disable invalid submissions. At the user's request, missing end defaults to a visibly disclosed 30-minute Google display length (one day for all-day). Original Worklog data is unchanged. Optional time adjustment uses existing native date/time picker and 30-minute/one-hour controls. Existing source end can also be adjusted for the Google copy.

The Today/overdue/upcoming work cards and schedule list used different UI paths. Reuse the existing bounded reminder linkage/snapshot read to expose a unique confirmed schedule ID to record cards. No extra per-card query, fabricated schedule, date guessing or ambiguous link selection. Canonical source/owner/status is re-read before export.

Preserve both native smoke paths: Settings Calendar connection, gallery picker/cancel, voice/navigation, native crypto. The old capture screenshot script's per-schedule connection target is obsolete and remains replaced by the Settings target.

## Reuse assessment

- Google Calendar official REST is already the provider. Its small adapter handles GET/insert/readback; app source validation, duplicate policy and UI remain application responsibilities. https://developers.google.com/workspace/calendar/api/guides/create-events
- expo-calendar opens device system calendar UI and accesses device calendars. It can reduce app-owned event UI, but does not provide the same connected-Google-account/direct-cloud-write/readback contract. Do not silently replace that behavior. https://docs.expo.dev/versions/latest/sdk/calendar/
- react-native-add-calendar-event is MIT but deprecated in favor of expo-calendar; do not add it. https://github.com/vonovak/react-native-add-calendar-event
- Google's googleapis Node client is Apache-2.0 and server-oriented; adding a Node runtime/backend solely for this two-method mobile adapter adds unnecessary structure. https://github.com/googleapis/google-api-nodejs-client
- Reuse existing native date/time picker, Expo browser/crypto and #473's MIT OCR wrapper/gallery packages. Google ML Kit model terms are recorded in the capture QA document. No new provider or dependency is added by the Calendar fixes.

## Verification boundary

Local integrated basic tests: 1008 pass; TypeScript pass. Native dependency installation uses the capture PR lockfile. CI exact-head APK/runtime evidence must be checked before delivery. Google real insert/GET/duplicate acceptance and real Korean capture OCR/date confirmation still require user device QA. No existing Google event is changed/deleted, no production DB is modified, and no long-lived Google token is stored.
