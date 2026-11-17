# Google Calendar 읽기 V1

사용자 요청(2026-11-17): 연결된 구글 캘린더 일정을 가져오는 기능 구현.
기존 #494 신규 기능 보류 중 이 기능에 대한 직접 요청을 승인 범위로 적용.

## 최소 실행 범위

기존 CalendarConnection → CalendarReadAdapter.list → Google events.list → 메모리 조회 결과 → 기존 홈/내 캘린더.
원본은 Google에 있으며 앱 Schedule/WorkRecord/ERP/알림으로 복제하지 않는다.
기존 calendar.events.owned 권한과 primary 대상, 암호화 연결 복원을 재사용한다.
공식 API로 해결되므로 신규 SDK·오픈소스·서버·DB·유료 의존성은 추가하지 않는다.

공식 근거: https://developers.google.com/workspace/calendar/api/v3/reference/events/list
singleEvents=true로 회차 전개, timeMin/timeMax로 표시 기간 조회, nextPageToken 페이지 처리.
최대 4페이지(페이지당 250개)까지만 조회하며 상한/손상 항목이 있으면 일부 표시라고 알린다.
읽기 중 화면 종료·월 이동·계정 변경 시 늦은 결과를 버리고 후속 페이지 조회를 중단한다.
종일 일정은 한국 날짜 자정과 배타적 종료일로 변환한다. 시간 일정은 명시된 offset을 유지해 한국 시간으로 표시한다.

## 검증과 사용자 가치

- 캘린더/홈/개인 일정 런타임 54개 PASS, mobile TypeScript PASS.
- 실제 조회 adapter의 GET-only·페이지·시간대·종일·취소·상한·오류 검사.
- 실제 connection/hook/화면의 읽기 전용 표시·날짜 수·재조회·지연 응답 계정 격리 검사.
- Android Metro/Hermes bundle export PASS. APK/네이티브 실기기 검수와는 별개.
- 기존 수정·삭제·캘린더 내보내기 회귀 보존. 사용자 데이터로 쓰기 테스트하지 않음.
- 목적: Google 앱과 업무수첩을 오가며 일정을 확인하는 동작 감소. 업무시간 절감은 미측정.

## 다음 요청된 QA 후보의 실제 계정 확인

Google 연결 후 홈/내 캘린더에서 제목·시간·종일·반복 회차 비교.
Google 원본 변경 후 새로고침, 앱 재실행, 연결 해제/계정 변경 시 표시 소거 확인.
320/390px 및 고정 음성 버튼과의 간섭 확인.
기존 약 50분 인증 만료 정책은 그대로이며 만료 시 재연결 안내.
공유/추가 캘린더 및 영구 가져오기/양방향 동기화는 이 V1에 포함하지 않음.
