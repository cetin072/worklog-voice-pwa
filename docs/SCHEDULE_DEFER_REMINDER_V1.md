# 일정 미루기 + 30분 전 알림 V1

Issue #327의 웹/앱 공통 경계다.

## 미루기
사용자 표시 선택지는 `1일 뒤`, `1주 뒤`, `15일 뒤`, `1개월 뒤`, `날짜 직접 선택`이다. 기존 일정의 제목/시간대/상태를 유지하고 시작 시각을 이동한다. 종료 시각이 있으면 기존 duration을 보존한다. 변경 전/후 시각은 `schedule_defer_history`에 남긴다. 시간이 있는 일정은 새 시작 30분 전으로 `reminder_at`을 다시 계산한다. 종일 일정은 사전 시각 알림을 만들지 않는다.

## 30분 전 알림
서버 판단은 `schedules`가 기준이다. `confirmed`/`tentative`, `all_day=false`, 아직 시작하지 않은 일정만 대상이다. 기본 `reminder_at`이 없으면 `starts_at - 30 minutes`를 사용한다. Netlify 스케줄러는 5분마다 실행하고 RPC는 현재 5분 창에 들어온 일정만 claim한다. `notification_deliveries`의 `schedule_advance` kind와 schedule/subscription unique key로 중복 발송을 막는다.

## 전달 계층
판단/미루기/중복방지는 공통 서버 기능이다. 현재 전달은 기존 Web Push를 재사용한다. 모바일 앱은 향후 동일 일정 데이터와 알림 판단 계약을 사용하고 App Push 또는 Local Notification 어댑터를 연결한다. PWA 전용 Snooze 액션은 이 범위에 넣지 않는다.

## 배포 게이트
두 migration은 저장소에만 추가한다. Production Supabase 적용은 사용자 명시 승인 전 금지한다. main 병합도 사용자 명시 승인 전 금지한다.
