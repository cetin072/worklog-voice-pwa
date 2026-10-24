# Android 안정화 검수 — 2026-10-24

상태: **PARTIAL — 자동검사 통과, 설치용 native artifact / 독립검수 / 실기기 수락 대기**.
대상은 `cetin072/worklog-voice-pwa`만. main 병합, Production 배포, Play 제출,
운영 DB 변경, 실제 계정삭제, 비밀키 생성/출력은 수행하지 않았다.

## 소스와 통합 전략

- main 재확인: `068cc5074a60079b6fd382cedeb3b8fb313f335e`.
- [PR #451](https://github.com/cetin072/worklog-voice-pwa/pull/451): Git pull ref `64bd480d3b3ef4924faac488e45d052e6accb3ea` 재확인.
- [PR #459](https://github.com/cetin072/worklog-voice-pwa/pull/459): Git pull ref `7618ef993acbdf3da6fdd84426495f2a77b1018b` 재확인.
- 기존 두 PR을 재작성/force-push하지 않고 `qa/android-stabilization-20261024`에서 main + 두 head를 merge. 충돌 없음.
- 새 음성 엔진/앱/중복 기능 없이 기존 PR 구현과 durable reminder service를 재사용.
- 이 브랜치는 통합 검수용이며 main 병합 제안 자체가 아니다. #451/#459는 원래 범위를 유지한다.
  추가 알림 수정은 별도 검토 가능한 커밋으로 유지한다. 기존 PR 병합 여부는 사용자의 검수 후 결정한다.
- GitHub REST/GraphQL API가 `Forbidden`: PR open/draft 상태, 리뷰/코멘트, #454/#455 본문 및 최신 실행 artifact는 재확인 불가.
  원격 Git ref 확인은 API 상태/리뷰 확인을 대체하지 않는다. Repository numeric ID도 API로 재확인하지 못했다.
- 최신 main의 AGENTS.md, roadmap, architecture, Mobile QA Fast Loop와 인접 코드/테스트를 읽었다.
  이 checkout에 `.agents/skills` 또는 추가 handoff 파일은 발견되지 않았고 `/workspace/.agents`는 비어 있다.

## 수정 및 검수 결과

1. 서버 일정 시각 변경 시 기본 시작 알림만 바뀌던 경로를 수정했다.
   기존 30분 전/1일 전 offset도 기존 service의 durable 취소/재등록 경로로 이동한다.
   이전 OS identifier 제거, 새 시각 3개 예약, 반복 동기화 중복 방지를 runtime test로 검증했다.
2. 한 일정 실패가 뒤의 다른 일정 동기화를 막지 않도록 끝까지 처리 후 AggregateError로 실패를 보고한다.
3. 세션 epoch가 바뀐 오래된 브리핑 응답은 알림 동기화에도 사용하지 않는다.
   브리핑 refresh queue가 알림 동기화 완료를 기다려 이전 응답의 후속 처리가 다음 refresh와 겹치는 범위를 줄인다.
4. PR #459에 `versionCode: 2`가 실제 포함되어 있다. main의 값은 1이다.
   expo-audio background recording 유지, background playback 비활성화.
5. PR #451 PCM 무음 압축/조용한 발화 보호 및 기존 음성 중복 저장/취소/재시도 runtime tests를 통합 실행했다.
   실제 한국어 인식 품질, 긴 침묵 후 발화, Whisper 모델 실행은 자동 단위검사로 대체할 수 없다.
6. 부팅 receiver는 Expo의 기존 예약 저장소를 재생한다. 서버를 직접 조회하는 부팅 동기화가 아니다.
   재부팅 전에 최신 서버 시각으로 앱 동기화가 성공해야 그 시각이 복구된다.

## 중요한 잔여 제한

- 브리핑은 전체 일정 목록이 아니다. 완료/취소 및 조회 기간 밖으로 이동한 일정은 응답에서 빠질 수 있다.
  빠진 ID를 삭제로 추정하면 정상 알림을 지울 수 있으므로 그렇게 구현하지 않았다.
  서버에서 취소/과거/조회 범위 밖으로 바뀐 기존 예약의 완전한 정합성은 **미해결**이며,
  소유한 예약 ID에 대한 canonical 조회/tombstone 계약 검토가 필요하다.
- 앱이 닫힌 동안의 서버 변경은 즉시 반영되지 않는다. session/login/app-active/수동 새로고침의 성공이 필요하다.
- 현재 설치앱의 SHA/hash/인증서 및 기존 로컬 데이터 보존 업그레이드 가능 여부는 미확인.
- 9월 27일 Run 36305471413은 전달받은 증거상 touch-smoke 합성 빌드다.
  이번 head의 알림/실제 음성/재부팅 PASS로 인용하지 않는다.
- 독립 리뷰어의 코드검수와 실기기 runtime smoke는 아직 없다.

## 자동 검증

- `npm test`: **852/852 PASS**, skip 0 (음성/알림/재부팅 계약 포함).
- `cd mobile && npm run typecheck`: **PASS**.
- `node scripts/verify-mobile-device-mutations.mjs`: **2/2 탐지 PASS**. Node 24 기본 reporter 변경으로 기존 파서가 오판한 문제를 `--test-reporter=tap` 고정으로 수정했다. fake-success 12개 실패, operation-queue 제거 1개 실패를 각각 15개 runtime tests에서 탐지했다.
- `EXPO_OFFLINE=1 npx expo install --check`: 설치된 dependency 검사 PASS; offline이므로 최신 원격 호환성 보증은 아님.
- `EXPO_OFFLINE=1 EXPO_PUBLIC_ANDROID_TOUCH_SMOKE=0 EXPO_PUBLIC_FORCE_WHISPER_FALLBACK_QA=0 npx expo export --platform android`: **PASS** (Hermes bundle).
- Expo config introspection: microphone FGS/RECORD_AUDIO/BOOT/EXACT_ALARM/POST_NOTIFICATIONS 존재,
  MEDIA_PLAYBACK FGS 없음, ReminderBootReceiver exported=false. **plugin manifest 계약 PASS**.
  Gradle library merge 및 최종 APK/AAB manifest 검사는 **PENDING**.
- 빌드한 JavaScript bundle은 설치용 APK가 아니다.

## 한 번의 설치 전 준비 Gate — 담당자용

현재 환경에 Android SDK/adb가 없고 사용할 설치 인증서가 확인되지 않아 APK/AAB를 생성하지 않았다.
새 키를 만들지 않았으며 기존 서명키를 조회/노출하지 않았다. 외부 유료 기기도 호출하지 않았다.

1. 이 브랜치의 exact SHA로 기존 Mobile App workflow의 standalone ARM64 경로를 사용한다.
   QA API endpoint는 승인된 비운영 계정/환경으로 고정하고 실제 사용자 일정은 변경하지 않는다.
   `EXPO_PUBLIC_ANDROID_TOUCH_SMOKE`는 반드시 0/미설정. production 자동배포/Play workflow는 실행하지 않는다.
2. 원칙상 일반 음성 경로가 포함된 한 APK를 먼저 준비한다. 강제 Whisper 플래그는 build-time이다.
   정상 경로 빌드에서 자연 fallback을 재현하지 못하면 해당 항목은 PARTIAL로 남기고,
   dedicated 장비에서 강제 fallback build를 검사한다. 사용자의 반복설치를 요구하지 않는다.
3. APK의 applicationId `com.cetin072.worklog`, versionCode 2, ABI, SHA256, signer certificate SHA256,
   빌드 exact SHA, QA flags, API endpoint, workflow run URL을 한 기록으로 남긴다.
   Gradle merged manifest와 `apkanalyzer manifest print`/`aapt` 결과에서 mediaPlayback FGS 부재,
   microphone FGS와 부팅 receiver 계약을 다시 검사한다.
4. 설치된 앱과 동일 인증서 및 versionCode >= installed가 확인될 때만 `adb install -r`로 1회 업데이트.
   서명이 다르면 중단. uninstall, clear-data, downgrade로 우회하지 않는다.
   CI의 임의 debug 서명은 기존 설치앱과 같다고 가정할 수 없다.
5. AAB가 필요하면 동일 소스/승인된 기존 signer로 artifact만 생성하고 Play 트랙 제출은 하지 않는다.
6. 설치 전 로컬 녹음/미저장 초안 보존 확인. 개인 음성/계정/일정 본문을 공개 로그나 PR에 첨부하지 않는다.

## 짧은 실기기 수락 체크리스트 — 준비 Gate 충족 후 1회 설치

- [ ] 앱/로컬 녹음/미저장 초안이 보존되고 위 SHA·hash·인증서 기록과 설치앱이 일치한다.
- [ ] 비운영 테스트 계정에서 보통 발화 → 저장을 빠르게 두 번 눌러도 기록 1개.
  저장 실패 후 원문 보존/재시도 1개를 확인한다.
- [ ] 짧은 문장 → 긴 침묵 → 작은 목소리 문장 → 저장: 앞뒤 문장 보존.
  실제 fallback 실행 로그(`pcm_compaction`, `transcribe_data`)가 있을 때만 Whisper PASS.
- [ ] 사용자가 이미 변경한 실제 일정은 **읽기만** 한다. 앱을 다시 활성화/새로고침하여
  서버 시각과 기기 예약 시각을 대조한다. 테스트 목적으로 실제 일정을 수정하지 않는다.
- [ ] 비운영 테스트 일정에서 이전 시각 예약 제거 + 새 시작/30분 전/1일 전 예약 수와 시각 확인.
  다시 새로고침해도 중복 없음. 앱 내 취소 후 예약 제거 확인.
- [ ] 새 예약을 동기화한 뒤 재부팅·잠금 해제. 앱을 다시 열기 전 예약 복구/예정 시각 1회 수신 확인.
  시간대, OS/API, 알림/정확한 알람 권한, 배터리 제한 상태와 결과 기록.
- [ ] 서버 단독 취소/조회 범위 밖 이동은 알려진 제한으로 별도 기록; 미검증을 PASS 처리하지 않는다.

## 계정삭제 검토만 수행

[PR #453](https://github.com/cetin072/worklog-voice-pwa/pull/453)의 정책/요청 페이지와 서명 기반은
삭제 운영 완료 증거가 아니다. `public/account-deletion.html`은 Netlify form/email 요청 경로다.
[Issue #454](https://github.com/cetin072/worklog-voice-pwa/issues/454),
[Issue #455](https://github.com/cetin072/worklog-voice-pwa/issues/455)는 PR로 표시하지 않는다.
최신 issue 상태는 API 차단으로 미확인. 소유 확인, 처리 담당/기한, 인증/업무 데이터,
Blob 연결정보/임시파일, 외부 서비스·로컬 파일 범위, 실패 재처리와 비운영 삭제 증거가 필요하다.
실제 요청 제출/삭제 시험/DB 조작은 하지 않았다.
