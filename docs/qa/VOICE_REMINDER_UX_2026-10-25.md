# 음성 기록 → 기기 알림 개선 검수

## 기준과 변경

- 대상: cetin072/worklog-voice-pwa만. 기존 QA branch
  `qa/android-side-by-side-20261025`의 `448c7af0d0c014a76470be0ad2638bdb0d4bc613`에서 이어감.
- 작업 branch: `qa/android-side-by-side-20261025-reminder-ux`.
- QA package `com.cetin072.worklog.qa`, name 업무수첩 QA, scheme worklog-qa 유지.
  backend는 기존과 동일. 아이콘은 existing 모드, 새 파일 의존성 없음.
- 날짜·명확한 시간이 있는 진주IC 가기/가는 일정, 명시적 알려줘를 보강.
  날짜 없음, 오전/오후 불명확, 복수/충돌 시각, 메모/기한 의미, 취소 요청은 자동 확정하지 않음.
  기존 parser의 모든 자연어를 완전히 해석한다는 의미는 아님.
- 저장 직후 기록 저장/일정 생성/기기 예약 확인을 분리. AggregateError의 실제 권한 원인도 표시.
- 저장 직후, 업무 상세, 메모, 일정에서 알림 설정 접근 가능.
  시작 시는 기존 자동 정책 유지. 30분 전/1일 전은 추가 예약이며 on/off 토글이 아님.
  기존 offset 전체를 canonical 시각으로 동기화한 뒤 선택 offset 예약.
- 날짜·시간 확인은 기본값 없이 한국 시간(Asia/Seoul)을 명시. 확인 취소는 쓰기 없음.
  중복 클릭 gate 및 기존 durable service 재사용. 서버 실패 시 native 생성으로 우회하지 않음.

## 서버 확인 계약과 소스 연계

서버 분리 PR은 #463이며 QA 앱 변경은 #462에 유지한다.
정식 SQL 소스는 `supabase/migrations/20261024171450_worklog_reminder_confirmation.sql`이다.
기존 migration 버전에 승인된 함수 코드만 동기화한다. 이미 이력이 있는 대상에 재적용하지 않는다.
개별 환경의 적용 여부·복구 자료는 이 문서로 추정하지 않고 승인된 내부 확인 절차를 따른다.

확인 RPC는 소유 기록을 잠그고 원본 종류·내용·기한을 보존하며 알림 일정을 연결한다.
삭제 RPC는 같은 잠금을 취한 뒤 기존 및 신규 연결 알림을 함께 취소한다.
신규 확인 RPC가 없는 환경에서는 앱이 서버 준비 필요를 안내한다.
서버 판정과 앱 배포는 별도이며 APK만 갱신한다고 모든 기능이 활성화되지는 않는다.
롤백은 기존 데이터와 확장된 취소 처리를 보존한다. 서버 PR의 보존형 롤백 문서를 참조한다.

## 검증 증거와 한계

- 전체 Node 회귀검사 926 PASS (이후 최종 SHA 검사 결과는 인계 보고 참조).
- TypeScript PASS. Android Hermes export는 APK/AAB 또는 native manifest 검증이 아님.
- 독립 리뷰: 취소 문구, 저녁 시각의 메모 오분류, 수동 프리셋 전체 동기화 누락을 발견/수정.
  재검수에서 추가 P1/P2 없음, 관련 runtime 36 PASS.
- `python3 scripts/test-worklog-reminder-postgres.py` PASS:
  네트워크 없는 임시 PostgreSQL 17, 공개 포트/secret/운영 연결 없음.
  실제 SQL로 owner, duplicate, payload conflict, note/due 보존, past, completed,
  cancellation, confirm→cancel 및 cancel→confirm lock 순서를 검증.
  기존 declarative schema의 single-$ delimiter는 테스트 fixture에서만 normalize.
  실제 Supabase 전체 배포/기존 모든 migration replay와 동일한 검사는 아님.
- 기존 서비스 회귀검사에 네트워크/부분응답/오래된응답/타계정/일정수정·취소/재진입/
  권한거절/예약부분실패/중복 예약이 포함된다. UI 실제 터치·물리폰 알림은 미검증.
- 사용자 설치본 SHA 미확인, screenshot byte download 실패로 픽셀 미확인.
  진주IC 실제 사건의 원인이 확정됐다고 주장하지 않는다.

## 빌드 / PR 차단

이전 `gh workflow run mobile-foundation.yml`은 GitHub workflow GET
`/repos/cetin072/worklog-voice-pwa/actions/workflows/mobile-foundation.yml`에서 Forbidden.
POST dispatch에 도달하지 않았고 이번에도 재시도/다른 인증·API로 우회하지 않았다.
PR 작성은 정상 GitHub 도구로 완료했다(#462, #463). 기존 workflow GET 거절은 재시도하지 않는다.
로컬 Android SDK/adb 없음. APK/AAB·signer·artifact SHA256·최종 native manifest·실기기 PASS 없음.

기존 Mobile App workflow에서 이 작업 branch, build_android=true, icon_variant=existing,
force_whisper_fallback_qa=false로 normal QA artifact를 만들어야 한다.
workflow trigger/권한/서명/credential을 변경하지 않았다. touch-smoke artifact는 실제 저장 검수용이 아니다.
기존 설치 인증서/데이터 보존 확인 전 삭제 후 재설치를 요구하지 않는다.

## 빌드와 서버 준비 뒤 한 번의 실기기 확인

1. 빌드 SHA와 앱의 QA 표시를 기록하고, 미래의 날짜·명확한 시각을 넣은
   “진주IC 가기” 또는 “자료 확인 알려줘” 한 건 저장. 저장/일정/기기 예약 상태 구분 확인.
2. 날짜·시간 없는 기록을 저장하고 알림 설정 열기 → 취소: 새 일정/알림 없음 확인.
   다시 열어 날짜·시간 확인 후 시작 시/30분 전/1일 전 중 유효한 시각을 예약.
   동일 버튼 반복 탭 시 중복 없음 확인.
3. 권한 거절 시 저장 성공과 예약 실패가 구분되는지 확인. 권한 허용 뒤 동일 기록에서 재시도.
4. 테스트용 일정만 수정/취소하고 앱 재진입·재부팅 후 이전 시각 알림이 남지 않는지 확인.
   사용자의 실제 업무 일정은 변경하지 않는다.

서버 미준비, 빌드 없음, 실제 폰 미검증은 PASS로 표시하지 않는다.
