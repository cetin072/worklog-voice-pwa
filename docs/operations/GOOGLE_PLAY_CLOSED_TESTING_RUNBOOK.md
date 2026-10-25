# 업무수첩 비공개 테스트 출시 후보 — 2026-10-25

## 범위와 계보

main 36e8e340f7d7a8d7f2eeb92701c8b97a18ffa806에서 분리.
사용자 수용 기준 QA c08adcc061cc8171abfe02f6289a45bb8af56b92의 알림 추가는 사용자 실기기 PASS. 이 검수를 반복하지 않는다.
모바일 음성 긴침묵/알림 예약·재동기화·취소와 관련 회귀검사만 선별한다.
QA app.config.js, .qa 패키지, QA CI/아이콘/문서 전체는 이식하지 않는다.
PR462 전체 병합 금지. PR459의 backgroundPlayback=false만 반영하고 versionCode=2는 이식하지 않는다.
PR451의 실기기 전체 수용과 PR454의 링크 터치 검수는 별도이며 자동 통과로 처리하지 않는다.
기존 PR459/462는 유지한다. 승인된 release PR 병합 시 중복 PR 정리 여부를 판단한다.

## 빌드 순서 — 태장 기존 절차 재사용

1. Play Console 업무수첩(com.cetin072.worklog)의 App bundle explorer와 모든 트랙/초안에서 최고 업로드 code 확인. QA code2는 근거로 사용하지 않는다.
2. 최고값과 그보다 큰 새 code를 승인받아 기존 Android Play AAB workflow의 highest_uploaded_version_code/release_version_code에 입력. source_ref는 검수한 정확한 SHA. 저장소 app.json의 기존 code1은 출시 확정값이 아니다.
3. 기존 PLAY_UPLOAD_KEYSTORE_BASE64/PLAY_UPLOAD_STORE_PASSWORD/PLAY_UPLOAD_KEY_ALIAS/PLAY_UPLOAD_KEY_PASSWORD를 그대로 사용. 없으면 중단하고 debug key로 대체하지 않는다. 키 신규 생성/교체 금지.
4. workflow는 production/default config, TOUCH_SMOKE=0, FORCE_WHISPER=0, existing 아이콘으로 bundleRelease. 외부 버전 입력은 검증 후 CI 작업 파일에만 적용한다.
5. artifact worklog-play-aab에서 AAB/해시/SOURCE_SHA/실제 merged manifest/upload certificate/build config를 대조. com.cetin072.worklog, target>=36, MICROPHONE FGS, BOOT/POST_NOTIFICATIONS/SCHEDULE_EXACT_ALARM 존재, MEDIA_PLAYBACK/USE_EXACT_ALARM/debug 부재를 검사한다.
6. 업로드 인증서는 Play Console의 기존 upload certificate와 사람이 비교한다. Play 앱서명 인증서와 upload 인증서는 구분한다. 기존 QA 인증서 일치는 요구하지 않는다. QA 앱 삭제 불필요.
7. 사용자 승인 후 Console 비공개 테스트의 기존 트랙에 AAB 수동 업로드. 앱 콘텐츠/접근/테스터/국가/출시 노트 검토 후 별도 제출 승인. Production 공개 금지. 이 workflow는 제출하지 않는다.

## 정책 및 앱 접근 — 미완료는 제출 차단

- privacy: https://worklog-voice-pwa.netlify.app/privacy.html
- deletion: https://worklog-voice-pwa.netlify.app/account-deletion.html
- 기존 정적 페이지와 외부 삭제 요청 양식/이메일 존재. 이 release에는 설정 내 두 링크와 열기 실패 안내만 추가. 운영 URL 실제 로드/양식 처리와 앱 링크 터치는 추가 증거 필요.
- #455: 계정 소유권 확인 → 정확한 계정/개인 workspace 확인 → 삭제량 검토와 별도 승인 → workspace 먼저/Auth 다음 → 연결 Notion 사본·Blob idempotency/checkpoint 정리 → 완료 회신. 보존 사유·기간 고지. 이 문서는 실행 SQL이 아니며 실제 삭제/계정 생성은 수행하지 않는다. 비운영 삭제 리허설과 Blob 정리 증거 미확보이므로 제출 전 해결 필요.
- 심사용 전용 활성 계정으로 이메일/비밀번호 로그인, 홈·기록·일정·알림·음성 화면 접근을 확인해야 한다. 자격증명은 Play Console App access에만 입력. 운영 개인 계정 재사용/저장소 기록 금지. 현재 확인 증거 없음.
- Data Safety 초안: 이메일/사용자ID(계정), 사용자가 저장한 업무·일정·전사 텍스트(앱 기능), 알림 등록 정보 및 진단 처리 여부를 실제 SDK/서버 계약과 대조. 회의 녹음은 로컬 보관, Whisper 전사 로컬; Android 음성 서비스는 서비스 설정에 따라 오디오 외부 처리 가능하므로 오디오 미수집을 일괄 선언하지 않는다. Notion은 선택적 연동. 광고·판매·서비스 제공자 예외는 실제 처리 목적/계약 기준으로 Console에서 최종 확인. 태장 위치/근태 항목은 복사하지 않는다.
- MICROPHONE: 사용자가 시작한 회의/업무 녹음의 지속 처리. Console FGS 설명과 시작/중지 시연 영상 필요. MEDIA_PLAYBACK 선언 제거.
- SCHEDULE_EXACT_ALARM: 사용자가 지정한 일정 시각의 기기 알림. Android 특별 접근 허용 확인/거절 안내를 기존 구현대로 유지. USE_EXACT_ALARM으로 바꾸지 않는다. 실제 정책 승인/권한 grant를 가정하지 않는다.

## 배포와 증거

서버 PR463 main 반영과 운영 배포는 별도. 정규 48시간 정책 유지, 강제 Netlify 배포 없음.
운영 DB/Auth/RLS 수정 없음. 승인 전 release main 병합/Play 제출 없음.
Android SDK 없는 로컬에서 TypeScript/Node runtime/Hermes export를 검사할 수 있으나 실제 AAB/native manifest/signature PASS와 같지 않다.
최고 code/기존 서명/Console 접근 미확인 상태에서는 정식 AAB 후보 번호를 확정하거나 서명 성공을 주장하지 않는다.
패치노트는 저장소 규칙상 병합된 내용만 기재하므로 이 PR main 병합 단계에 갱신 여부 확인.

공식 기준: https://support.google.com/googleplay/android-developer/answer/10144311
FGS: https://support.google.com/googleplay/android-developer/answer/13392821
정확한 알람: https://developer.android.com/about/versions/14/changes/schedule-exact-alarms
