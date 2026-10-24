# Draft PR: 음성 기록의 일정 판정과 기기 알림 확인 동선 개선

음성 기록이 저장됐는데 기기 알림이 예약됐는지 알 수 없고, 이동 표현·명시적 알림 요청이 일정에서 빠지는 문제를 개선한다. 기존 QA 앱 분리 작업(448c7af)을 바탕으로, 저장·일정 생성·실제 예약 결과를 분리하고 기록/일정의 알림 설정 버튼과 시작 시/30분 전/1일 전 예약을 연결한다.

모호한 기록은 기본 시각 없이 명시적 확인을 거친다. note/task 의미를 보존하는 owner-scoped 원자적 확인 SQL과 record 삭제 동시성 보완은 기존 migration 버전의 정식 SQL 소스로 포함한다. 대상별 적용 상태는 별도 확인한다. 서버 준비 전에는 신규 기록 알림 확인이 안전하게 실패하고 안내한다. main 병합/배포/Play 제출은 요청하지 않는다.

검증: 전체 Node 926 PASS, TypeScript PASS, 격리 PostgreSQL 17의 소유권·중복·충돌·과거/완료·삭제 양방향 동시성 PASS, 독립 재검토 추가 P1/P2 없음. 최종 SHA의 export/검사 결과는 인계 보고 참조. APK/AAB·설치본 SHA·물리폰 알림은 미검증이다. 상세는 VOICE_REMINDER_UX_2026-10-25.md 참조.

Base 권장: qa/android-side-by-side-20261025 (기존 QA 변경만을 제외한 검토 diff).
Head: qa/android-side-by-side-20261025-reminder-ux.
QA PR #462와 서버 분리 PR #463을 연계한다. 두 PR의 범위를 합쳐 main에 일괄 반영하지 않는다.
