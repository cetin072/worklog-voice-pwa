# Android 안정화 추가 검수 — 2026-10-24

이 문서는 최초 `ANDROID_STABILIZATION_2026-10-24.md`의 미해결 항목을 갱신한다.
상태: **코드/자동검사/독립 코드검수 PASS, native 빌드 및 실기기 PARTIAL**.

## 범위 밖 이동/서버 취소 계약 해결

- 브리핑 today/upcoming은 신규 ID 발견 용도로만 사용한다. 기존 추적 ID와 합쳐 기존 Supabase `schedules`를 날짜/상태 필터 없이 직접 읽는다.
- 인증 서버 `getUser`로 사용자를 확인하고 creator 조건 및 기존 RLS를 적용한다. 응답에도 creator 일치를 검증한다.
- 최대 100개 ID씩 요청하며 exact count와 실제 행 수가 다르면 전체 응답 적용을 중단한다. 모든 batch를 수집/검증한 뒤에만 단말을 바꾼다.
- 요청하지 않은 ID, 중복, 미지 상태, 잘못된 날짜/제목/all_day, 타계정, 인증 실패는 적용하지 않는다.
- 삭제/비공개/RLS 때문에 반환되지 않은 ID는 **unresolved**로 보존한다. 목록 부재만으로 취소하지 않는다.
- 명시적 cancelled/completed/tentative/all-day/과거 상태만 해당 일정 알림을 정리한다. 미래로 이동한 일정은 기존 offset을 새 시각으로 재등록한다.
- 세션·refresh 세대 및 server updated_at 역행을 확인한다. 이전 계정의 늦은 직접입력/음성/수정/삭제 응답도 차단한다.
- broad native sweep을 이 lifecycle에서 제거했다. 서버 확인 전에 만료된 로컬 mapping을 지워 범위 밖 이동한 ID를 잃는 경로가 없다.
- durable state 기록 callback 및 native 호출 직전까지 guard를 확인한다. native 호출 전 무효화된 intent는 원래 state로 되돌려 다음 복구에서 실행되지 않게 한다.
- 이미 OS에 요청을 발행한 뒤의 무효화는 원자적으로 취소할 수 없다. 그 경우 복구 journal을 보존하며 다음 canonical 동기화로 수렴한다.
- hard-deleted/RLS-hidden/알 수 없는 ID는 여전히 자동 삭제하지 않는다. 명시적 tombstone 없는 상태에서 안전을 위한 의도적 제한이다.

DB schema/migration/RLS 변경 없음. 운영 DB 읽기/쓰기/계정삭제 시험을 실행하지 않았다.
검증은 설치된 Supabase client의 mock fetch 계약과 production TypeScript + 모의 native/storage 경계에서 수행했다.
공식 참고: [select/count](https://supabase.com/docs/reference/javascript/select), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
Changelog markdown fetch는 접근 오류로 읽지 못했으며 설치된 2.116.0 코드/기존 스키마와 공식 reference를 대조했다.

## 독립 검수

별도 읽기 전용 reviewer가 발견한 다음 결함을 보완 후 재검수했다.

1. recovery/refresh 병렬 시작으로 최신 조회가 무효화됨 → 순서화.
2. native list 대기 중 무효화 뒤 삭제 → 호출/intent 기록 직전 guard 및 지연 경계 테스트.
3. 빈 취소 RPC 성공 응답으로 삭제 → 정확한 단일 ID/cancelled 상태 검증.
4. 로컬 만료 정리로 범위 밖 이동 ID 상실 → canonical 우선, broad sweep 제거.
5. 이전 계정의 늦은 저장 응답 → 요청 시작 시 session guard 전달.
6. 복구의 계정/검증 ID 범위 바깥 정리 → 동일 guard의 canonical 적용으로만 복구.

Reviewer 최종: **독립 코드검수 PASS**, 당시 관련 runtime suite 45/45 PASS,
추가 미해결 P1 없음. 이는 실제 Android/음성/재부팅 PASS가 아니다.

## 최종 자동검사

- 전체 `npm test`: **884/884 PASS**, skip 0.
- `npm run typecheck`: **PASS**.
- 정상 flags (`ANDROID_TOUCH_SMOKE=0`, `FORCE_WHISPER_FALLBACK_QA=0`) Android Hermes export: **PASS**.
- device-state mutation: **2/2 탐지 PASS**.
- `git diff --check`: PASS.
- 신규 runtime: 서버취소, 브리핑 밖 시각 변경, network/count 부분응답, 타계정/세션전환,
  오래된 응답·revision, 응답 부재, 큐 지연·native list/permission 지연, 잘못된 취소 RPC,
  실제 post-save/edit/delete/recovery 연결, 설치된 Supabase query serialization 검증.

## 안전한 CI 빌드

기존 `.github/workflows/mobile-foundation.yml`의 `android-standalone`을 재사용한다.
기존 서명 설정을 변경하지 않았다. 새 키/credential 생성 단계는 추가하지 않았다.
standalone의 TOUCH_SMOKE를 0으로 고정하고 source SHA, APK SHA256, 공개 signer certificate,
최종 manifest/package/versionCode, 수락 체크리스트를 기존 APK artifact와 함께 저장하도록 보강했다.
최종 manifest 검사에서는 mediaPlayback FGS 부재, microphone/BOOT/EXACT_ALARM/POST_NOTIFICATIONS를 확인한다.

이 workflow는 APK build와 emulator smoke를 수행한다. Firebase 유료 실기기 workflow는 호출하지 않는다.
현재 환경에는 Android SDK/adb가 없다. 이것은 **로컬 빌드 제한**이다.
기존 설치 인증서 미확인은 **업그레이드 설치 호환성 제한**이며 빌드 자체의 금지 사유가 아니다.
CI 실행 결과와 artifact URL/hash는 실행이 확인되어야만 채운다. Play AAB/트랙 제출은 실행하지 않는다.
API Forbidden 경로를 다른 인증/URL/trigger 변경으로 우회하지 않는다.

## 아이콘 적용 대기 및 QA 구조 확인

- Base: `libfile_dcb45eba3ee48191a3072d18e2add6ab`, `worklog-launcher-1024.png`, v0.
- QA: `libfile_2cd16b335b848191b7383ff710fed5e9`, `worklog-qa-launcher-1024.png`, v0.
- 사용자 채택 이미지이며 부모 설명상 두 파일 모두 opaque 1024 PNG. 아직 로컬 픽셀 검수 전이다.
- Library prepare_materialize는 성공했지만 공식 helper materialize가 `download failed`로 종료했다.
  Base는 기본/승격 실행 모두 실패, QA도 실패. `mobile/assets`에 파일 없음.
  URL 추정, 부모 로컬 경로, 수동 다운로드 등으로 우회하지 않았다.
- 적용은 **PENDING**. 새 이미지가 빌드에 포함됐다고 주장하지 않는다.
- 현재 mobile/app.json에는 icon/adaptiveIcon/web.favicon이 없다. 정상/QA 모두 동일 package
  `com.cetin072.worklog`와 scheme을 사용한다. smoke/Whisper QA는 build flag 차이이며 별도 앱이 아니다.
- 웹은 `public/icons/*-v6.png`: index favicon/apple-touch/OG/Twitter/preload 및 manifest.webmanifest가 참조한다.
- 전송 해결 후 base를 launcher/PWA/favicon으로, QA 변형은 명시적인 기존 QA 빌드 선택으로 적용한다.
  불투명 원본을 투명 foreground라고 표시하지 않는다. adaptive mask safe zone과 16/32/48px 가독성을
  실제 픽셀로 확인한 뒤 asset 파생/설정을 반영한다.
- 별도 QA 패키지/계정/DB/backend 분리 승인 없음, 구현하지 않았다.

main 병합, Production 배포, Play 제출, 운영 DB 변경, 실제 삭제 시험은 계속 제외한다.

### 실제 실행 결과

- 코드 체크포인트: `112f9533d464199fd573fb160831c89c704ecdac` (원격 통합 브랜치 push 확인).
- 기존 Mobile App workflow dispatch 시도:
  `gh workflow run mobile-foundation.yml --repo cetin072/worklog-voice-pwa --ref qa/android-stabilization-20261024 -f build_android=true`.
- 결과: workflow 조회 GET `/repos/cetin072/worklog-voice-pwa/actions/workflows/mobile-foundation.yml`에서 `Forbidden`.
  **dispatch POST에 도달하지 않음 / 빌드 시작되지 않음**. 다른 endpoint/인증/trigger로 우회하거나 재시도하지 않았다.
- PR 상태 조회·갱신도 API 차단으로 불가. Git branch push는 성공했지만 PR 갱신으로 표시하지 않는다.
- APK/AAB/최종 manifest/설치 hash는 아직 없음. 정상 Hermes export와 plugin manifest만 검증됨.
- 두 아이콘의 디자인 승인은 확정되어 추가 디자인 확인은 필요 없다. 파일 전송이 해결되기 전
  존재하지 않는 asset을 config에 연결하지 않는다. 현재 코드 빌드에는 새 base/QA 아이콘이 포함되지 않는다.

### 전송 실패 분류 및 bounded retry 종료

- GitHub: `gh workflow run`의 workflow 조회 GET 단계에서 `Forbidden` 출력.
  조회가 실패했고 dispatch POST는 실행되지 않았다. API 차단의 원인이 네트워크 정책인지
  저장소/토큰 권한인지는 반환 출력만으로 확정하지 못했다. 추가 API 재시도/우회 없음.
- Library: `library_prepare_materialize`는 두 항목 모두 성공(`isError:false`, unavailable_items=[]).
  QA 재준비에서도 version 0 및 signed transfer를 정상 반환했고 경고가 없었다.
  이 단계의 파일 접근 권한 거절은 관측되지 않았다.
- 실패 지점은 **공식 `library_file_transfer.py materialize`의 실제 byte download 단계**다.
  반환은 exit code 1, stderr `library file transfer failed: download failed`뿐이다.
  HTTP 상태/하위 예외가 노출되지 않아 권한 거절이나 일시 장애 중 어느 것인지 단정할 수 없다.
  자동 승인 리뷰의 거절 메시지도 없었다.
- Base: 공식 helper 기본 실행 1회 + 승격 실행 1회, 합계 2회 실패.
  이미 bounded retry를 수행했으므로 다시 준비/다운로드하지 않았다.
- QA: 최초 공식 실행 1회 실패 후, 사용자의 추가 지시에 따라 consumer-local 목적지
  `/workspace/worklog-voice-pwa/mobile/assets`를 명시한 fresh `prepare_materialize`와 공식 helper로
  **1회 재시도**했다. 다시 같은 exit code/stderr로 실패했다. 이후 재시도 중단.
- 최종 파일 존재 검사: base/QA PNG 모두 exists=false. 부분 파일 적용, hash 검증, 픽셀 검수 없음.
  source/config는 그대로이며 설치 빌드에 새 아이콘이 들어간 상태가 아니다.
- 해결에는 새 디자인 승인보다 **전송/연결 경로 복구**가 필요하다.
  아이콘은 두 PNG를 이 실행 환경이 읽을 수 있는 정식 첨부로 전달하거나 Library 전송 경로를 복구해야 한다.
  CI는 저장소 접근 및 환경의 GitHub API 연결을 확인하거나, 권한 있는 사용자가 GitHub UI에서
  기존 Mobile App workflow를 통합 브랜치로 수동 실행하여 결과 artifact를 제공할 수 있다.
  키/토큰을 대화나 저장소에 제공할 필요는 없다. 빌드 후 설치는 인증서 일치 검증 전까지 보류한다.
