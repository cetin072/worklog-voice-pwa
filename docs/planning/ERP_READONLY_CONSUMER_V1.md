> **2026-11-02 변경:** 사용자 승인 방향은 태장 단일 Supabase + Google 기본 로그인입니다. 아래는 첫 연결 시도의 이력이며 현재 실행 기준은 [단일 프로젝트 이전 준비](SINGLE_PROJECT_REHEARSAL_V1.md)입니다. 두 프로젝트 연결/동일 이메일 비교를 확장하지 않습니다.

# 태장 ERP의 업무수첩 읽기 전용 소비 계약

2026-11-02 사용자 승인: 두 저장소 실사 및 기능 브랜치/Draft PR/개발 Preview까지. 운영 DB/Auth/권한/migration·앱 배포 변경은 금지.

이번 모바일 앱/업무수첩 서버 코드 변경은 필요 없다. 기존 canonical schedules/work_records와 RLS를 태장 서버가 업무수첩 사용자 access token으로 GET한다. 업무수첩 runtime을 다른 repository에서 import하지 않는다.

태장 구현: `cetin072/taejang_homepage` branch `codex/erp-worklog-readonly`, `docs/planning/ERP_WORKLOG_READONLY_V1.md`.

- 인증은 프로젝트별 `/auth/v1/user`에서 각각 검증, 양쪽 인증된 이메일 일치 필요. 태장 직책/이름/동일 UUID 추정으로 연결 금지.
- personal workspaces.owner_user_id 및 workspace_members.owner의 본인만. client가 workspace/user를 선택하지 않음.
- schedules: confirmed/tentative, 본인 작성, KST 월/오늘 범위 중첩.
- work_records: 본인 작성, action_kind null/task, status in_progress/waiting/needs_review. 업무수첩 briefing-reader의 상태 의미를 재사용. note·취소·완료 제외.
- 기존 bootstrap_personal_workspace는 쓰기 가능성이 있어 호출하지 않음. 새 테이블/서비스키/edge function/토큰발급 우회 없음.
- 조회 항목은 id/title/time/status 위주. 녹음·전사 원문·metadata·첨부를 보내지 않음.
- ERP에서 별도 업무수첩 로그인은 필요. refresh token 공유·모바일 로그인 이전 없음.

읽기 전용 운영 실사: personal 공간 5개, 일정51건(confirmed31/cancelled20). 두 프로젝트의 이메일 일치1쌍이나 양쪽 인증 일치0쌍이므로 실제 본인 데이터 연결은 차단. 개인 이메일/ID/제목은 공개 기록하지 않음. 실제 모바일 일정이 ERP에 나타난 것으로 완료 보고 금지.

장기 Auth/데이터 이전은 대상 테이블만 옮기는 일이 아니다. storage·함수·알림·OAuth·기존 RLS·Auth ID 참조·앱 URL/key·롤백까지 별도 감사/리허설/사용자 승인 필요. 이번 PR은 소비 계약만 기록하며 앱 패치노트·Android 빌드 불필요.
