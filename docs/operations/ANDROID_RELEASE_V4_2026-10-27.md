# Android code 4 release preparation — 2026-10-27

## Authorization and source

The user requested completion of the approved icon, optional in-app update notice,
compact reminder/edit follow-up, and the next Play update in this conversation.
This supersedes the earlier Draft-only restriction for #470/#471, without authorizing
DB/auth/signing/package changes, a web release, or unrelated QA branch merges.

- #470 merged as cf239b90d4cef0c21625cd9f94a3c83a2251d2c6.
- #471 latest head e4a4a83affcf55c38d08023a5242d40322d3c6b8 merged as 28dd03c5c9e231ffbdba22758d7e1aa9e00e579e.
- Exact tested/build source: 91edb9319fb6f74a305e68d4c1380a1bcfe2d4b2.
- Existing code3 was shown in the user's Console screenshot as available to Alpha testers, full rollout, active; code2 inactive. It was not cancelled/replaced.

## Verification

- Combined suite: 969/969 passed; mobile TypeScript passed.
- Mobile CI https://github.com/cetin072/worklog-voice-pwa/actions/runs/40467919468: all 5 jobs SUCCESS.
- New worklog-play-update Kotlin module compiled; production ARM64 APK built.
- Real Android35 synthetic session: home/journal navigation, direct input, recording start/cancel and navigation after cancellation passed.
- Actual rendered home captures: 320/390 logical width and 320 at font_scale 1.4. Long labels wrap; schedule and task use the same compact unknown status. Both approved launcher variants displayed correctly.
- Capture artifact 12718157346, exact source above; ZIP SHA256 15541eaeee9f161b1f7260a87d3a07ad4d16cef7e17d1dd6f4d27772030d28f1.
- Source fixtures are synthetic, guarded by the existing touch-smoke build flag; production build rejects that flag. They contain no personal tasks and do not use production data.
- Actual positive/negative Play account eligibility, phone TalkBack/back/store behavior, account switching and notification delivery remain Human QA. Component/runtime mocks cover update availability/offline/timeout/dismissal/relaunch/store fallback and reminder linkage/permissions/dirty edit races.
- Previous physical device run40430044174 failed before test execution with TEST_QUOTA_EXCEEDED; it is not an app regression or a final-source physical-device PASS. No paid quota change was made.

## Preserved boundaries

Voice widget source/layout/idle label, authentication and startup branding preserved.
No schema/RLS/auth/permission/signing/package changes; #466/#469 unmerged.
No manual web production deployment; scheduled web exclusion preserved.

## Play installation and notice semantics

Code3 has no update-notice native module. Code4 must first be installed from Play.
The optional prompt appears only when Google Play returns UPDATE_AVAILABLE for
the installed user's package/track; a new AAB alone is insufficient. A newer eligible
release after code4 is needed for positive end-to-end prompt QA.

The approved store icon is the same production original resized to 512px, opaque
32-bit PNG. Store listing artwork is a separate Console field from the bundled launcher.

## Submission boundary

The cloud Console remains at Google sign-in; the user-facing browser handoff was
unusable even with a fresh tab. The user's separate Console screenshots prove code3
release status, not authentication of this cloud session. Do not claim code4 submission
until Console upload/review submission is actually verified.

## Verified Play artifact

- Build https://github.com/cetin072/worklog-voice-pwa/actions/runs/40468028359 SUCCESS (28m18s).
- Artifact12718219089: worklog-play-aab; ZIP SHA256 ce6be5ee34948c99609e9c7c04df77c3349e4d10db944ae7d54a47e8fedd7d3b.
- worklog-0.1.0-vc4.aab: 86,695,547 bytes; SHA256 12ff1d6ed55fcb2822c1e7a95cf8deb8e7cf3d919ca344b15ab789485529946d.
- Extracted manifest and build config both com.cetin072.worklog / 0.1.0 / versionCode4; SOURCE_SHA matches exact source above.
- CI jarsigner verification passed; upload certificate SHA256 matches code3:
  07:B1:51:1F:82:A8:32:11:CB:51:89:3D:9F:78:B6:50:06:E4:DD:42:86:AC:20:55:06:2F:59:6B:66:F5:CF:D2.
- This is a Play Console upload bundle, not a directly installable phone APK.
- Bundle and approved store icon prepared for upload; code4 Console upload/review submission NOT performed because cloud authentication is unavailable.

Release name: 업무수첩 0.1.0 (4) 아이콘·업데이트 안내·알림 표시 개선

Suggested Korean release notes:
- 앱 아이콘을 새 수첩 디자인으로 변경했습니다.
- 새 버전을 받을 수 있을 때 앱 실행 중 선택형 업데이트 안내를 표시합니다.
- 일정과 업무의 알림 상태를 같은 짧은 버튼으로 정리했습니다.
- 업무 수정 시 제목을 바로 입력하고 확인된 날짜·시간을 재사용합니다.

Use the existing Alpha track; do not cancel or replace the already published code3.
Register the store icon in the main store listing, then review the new code4 release
and submit the intended changes together. No production-access application is needed
for this Alpha update. Human QA after Play delivery remains distinct from this
synthetic native validation.
