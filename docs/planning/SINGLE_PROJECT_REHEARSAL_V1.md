# 태장 단일 Supabase · Google 기본 로그인 이전 준비

2026-11-02 사용자 결정: 최종 구조는 태장 프로젝트 하나, 기존 ERP 첫 대시보드, 직원용 출근앱과 임원/지정 직원용 업무수첩 유지. Google 계정을 본인의 기본 로그인으로 사용. 이 체크포인트는 운영 변경 전 읽기 실사와 복제 구조/합성 데이터 실행 검증이다.

## 구조 결정

- 태장 Auth 사용자 ID를 유지하고 Google identity를 연결하는 방식이 우선. 근태/승인/직원/권한 참조를 새 Google 사용자 ID로 갈아끼우지 않는다.
- 업무수첩의 이전 사용자 ID는 명시적으로 검증한 사용자 매핑으로 태장 ID에 치환. 일정/업무/공간 ID는 보존하여 source_refs, metadata의 entity 연결을 유지한다.
- 하나의 DB 안에서 worklog / worklog_private 스키마로 업무수첩만 구분. 별도 서버나 동기화 서비스 추가 없음. 기존 public.notification_deliveries와 이름 충돌을 피한다.
- 태장 API는 기존 로그인 token을 같은 프로젝트 Auth/기존 활성 Profile RPC에서 확인한 뒤 worklog 스키마에 Accept-Profile을 지정한 GET만 실행. 별도 업무수첩 세션/비밀번호/동일 이메일 비교를 제거한다.
- `WORKLOG_UNIFIED_READ_ENABLED=true`가 없는 환경에서는 통합 준비 상태로 차단한다. 현재 실제 환경변수는 설정하지 않았다. worklog schema 미노출/오류에 public 또는 기존 업무수첩 프로젝트로 fallback하지 않는다.

## 읽기 전용 실사 결과

- 대상: 태장 jgsxpdflgkqroecfjzxq, 원본: 업무수첩 zlhdhwgabqzsuuhaiedc. 검증 당시 main: 태장 c8ffc093 / 업무수첩34cba241.
- 업무수첩 Auth5명, Google provider3명. 사용자 요청 계정은 이메일 인증/Google identity 정상. 본인 확정 일정31건. 첫 동일이메일 검색 결과를 본인 인증 상태로 오해하지 않는다.
- 업무수첩 저장소/테이블14개 모두 RLS 활성. storage bucket0개. 서버 Edge Function notification-scheduler-gateway1개. 녹음/이미지 등 로컬 원본은 DB storage가 아니라 기기/외부 참조까지 확인해야 함.

| 테이블 | 행수 |
| --- | ---: |
| workspaces | 5 |
| workspace_members | 5 |
| work_records | 280 |
| schedules | 51 |
| source_refs | 280 |
| work_record_normalizations | 280 |
| push_subscriptions | 7 |
| notification_deliveries | 85 |
| notification_preferences | 1 |
| candidates / input_captures / usage_events / shared_cost_pools / shared_cost_allocations | 각0 |

실사 중 새 데이터가 생길 수 있으므로 이전 직전 다시 세고 해시/스냅샷을 확보한다. 실제 원문/녹음/일정제목/이메일/개인 Auth ID/토큰은 공개 저장소에 저장하지 않았다.

## 실제 확인된 차단점

1. 태장과 업무수첩에 notification_deliveries 동명 테이블이 있으므로 public 그대로 일괄 replay 금지.
2. 사용자가 Google 로그인에 쓸 이메일은 태장 Auth에도 이미 존재. 해당 Profile은 deleted, 이메일 미인증/email provider 상태이며 정상 Google identity는 아님. 그 행은 Profile1건·상태변경 이력2건·감사로그1건에서 참조됨. 삭제/복구/역할 승계 금지. 이 이메일 충돌을 이력 보존 방식으로 해소하는 구체적인 Auth 작업안 검수 전에는 identity linking을 실행하지 않음.
3. 원본5명 중 본인 외4명의 이전 대상/동의/대상ID가 미확정. 본인만 매핑하고 전체 이전 완료로 처리하지 않음. 개인 이름/이메일 자동 매칭 금지.
4. RPC·gateway·모바일·웹의 schema 소비 코드는 아래와 같이 준비했다. 실제 Data API schema 노출, OAuth/provider/manual linking/redirect 설정, 사용자 Google 인증, 알림 재등록, 기기 local-first 원본/첨부와 실제 이전은 수행하지 않았다.

## 실행본과 검증 범위

- `scripts/consolidation/remap-worklog-rows.mjs`: 네트워크/SQL/Auth 쓰기가 없는 오프라인 변환. 14개 테이블 모두 요구, 카탈로그의 Auth FK 열만 명시 매핑, 미매핑/unknown table/다대일 합치기/personal 공간 충돌 거부. 원본 입력 불변. 임의 metadata 텍스트/ID는 수정하지 않음. metadata 안의 사용자 식별자는 별도 감사 후 처리해야 함.
- `scripts/consolidation/identity-preflight.mjs`: 활성/인증된 ERP와 Google source 조건을 확인하고, deleted/unconfirmed 계정이라도 이메일 점유가 있으면 GOOGLE_EMAIL_COLLISION으로 중단. 결과만 반환하며 actual Auth 연결/이메일 해제/계정 복구를 하지 않음.
- `supabase/rehearsal/unified-worklog-catalog.sql`: 운영 카탈로그에서 복제한 테이블14·제약·비제약 인덱스36·정책39·보조함수6·트리거10. 카탈로그 표현에서 생략된 schema를 명시해 다른 public 객체에 연결되지 않게 수정. 소스 데이터0건.
- 이 SQL은 **운영 migration이 아님**. read rehearsal을 위해 authenticated SELECT만 부여. 앱 쓰기 권한, 전체 RPC, Auth bootstrap trigger, scheduler secret/cron은 포함하지 않음. pg_trgm 필요. 실제 migration 경로에 넣지 않음.
- `tests/unified-worklog-transfer.test.mjs`: PGlite(PostgreSQL WASM)에서 실제 DDL/RLS/FK/transaction 실행. 업무·일정 합성 데이터 소유권 치환/ID·원문 보존, 타 직원/익명 차단, 태장 동명 알림 테이블 불변, 실패 트랜잭션 rollback. 완전한 Supabase/Auth/REST/실사용 검수와 구분.
- Push subscription은 데이터 개수/이력은 보존하되 새 프로젝트에서 재발송되지 않도록 disabled 상태로 변환. 원본 시스템의 값을 바꾸지 않음. 정상 알림은 재등록·재검수 후 별도 활성화. delivery 이력은 재시도 대기로 바꾸지 않음.
- 태장 PR575에는 통합형 read API/UI와 Google PKCE 연결 화면을 기본 비활성 상태로 준비. 업무수첩 runtime은 아래 명시적 opt-in만 추가하며 기존 public 기본값을 보존. APK/Play 제출 없음.

## 실제 적용 전 남은 순서

1. 과거 이메일 점유 계정 이력 보존/충돌 해소 작업안을 확정하고 기존 태장 로그인 중 Google identity linking 진행. Google 인증은 사용자 인터랙션 필요. 기존 사용자ID/직원/역할/이력 불변 재검증.
2. 본인 pilot와 전체5명 전환 범위를 구분. 사용하지 않는 계정도 동의 없이 병합/삭제하지 않는다.
3. 전체 RPC·gateway·mobile schema 소비 경로를 준비하고, 승인된 격리 환경에서 서버/앱 실행 검증. 인증 callback 허용과 신규 Google 로그인에 따른 pending Profile 생성 부작용도 점검.
4. 원본 read-only snapshot/일관된 export와 백업·해시·복원시험 후 신규 schema+데이터를 transaction으로 복사. 원본 보존. 실제 데이터 내용/개수/FK/RLS 검증 후 API schema expose.
5. 기존 Google 연동/기기 local 자료를 보존하는 재로그인·세션 전환과 알림 재등록 검수. 전환 중 쓰기는 단일 원본만 허용. 검증 완료 후 read 스위치 활성화.
6. 최종 사용자 승인 후 main/운영/Play 전환. 기존 프로젝트 삭제는 이번 범위에서 제외. 원본을 다시 쓸 때는 전환 후 신규 기록을 먼저 회수·조정하며 환경변수만 되돌려 데이터가 사라지는 롤백을 하지 않는다.

현재 상태: 코드/합성 이전 시험 준비. 운영 데이터 복사0, Auth 변경0, 실제 본인 Google 로그인 연결0. 원래 성공 조건(모바일에 이미 있는 실제 일정이 ERP첫 화면에 표시)은 미달성.

공식 근거: https://supabase.com/docs/guides/auth/auth-identity-linking , https://supabase.com/docs/guides/api/using-custom-schemas . 수동 identity linking은 설정 활성화 및 로그인한 사용자의 Google OAuth가 필요하며 프로젝트 간 Auth identity를 SQL로 복제하는 대체재가 아니다.

## 추가 실행 준비: 앱과 전체 RPC

- `unified-worklog-rpcs.sql`: 운영 함수 정의를 스키마만 옮긴 38개 함수의 격리 재생 파일. migration 폴더 밖에 있으며 실제 운영 적용 없음. 기존 catalog 파일 다음 실행한다. 저장·일정 연동·오늘 브리핑·검색·편집·완료 흐름을 합성 데이터로 실행한다.
- 일반 사용자 bootstrap은 **기존에 이전된 본인 personal workspace + owner membership + 활성 태장 Profile**만 확인한다. 새 workspace나 권한을 자동 부여하지 않는다. 미지정 직원과 정지 계정은 조회/시작 차단. Auth signup trigger를 설치하지 않는다.
- `WORKLOG_DATA_SCHEMA=worklog`일 때 서버 REST/RPC, workspace resolver, 웹 검색, 모바일 Supabase SDK가 같은 schema를 사용한다. 미설정은 기존 public 동작 유지. 잘못된 schema는 차단하며 public 재시도 없음. Auth 요청에는 schema header를 붙이지 않는다.
- 모바일은 기존 SDK의 프로젝트별 SecureStore key를 유지하므로 기존 프로젝트 토큰을 새 프로젝트로 재사용하지 않고, 기존 key도 삭제하지 않는다. 웹은 통합 설정에서 JWT issuer routing guard로 옛 프로젝트 access/refresh token 전송을 막는다. issuer 문자열만으로 사용자 인증하지 않으며 실제 Auth 검증은 서버가 한다.
- 알림 gateway에도 같은 schema opt-in을 준비. 이전용 SQL의 scheduler secret 검사는 의도적으로 항상 false다. 원본 credential hash/cron을 복사하지 않는다. 새 secret 설정/구독 재등록/중복 방지 실검수 후 별도 활성화가 필요하다.
- PGlite 테스트는 실제 PostgreSQL 함수/RLS/transaction을 실행하지만 hosted Supabase·실제 Google·휴대폰 로그인 검수와 다르다. 모바일 runtime 검사는 native 저장소를 모의하고 실제 Supabase SDK의 REST/RPC 요청과 프로젝트별 key를 검사한다.

## Google 주소 충돌의 이력 보존 작업안 — 미실행

1. 정확한 기존 점유 Auth UUID와 deleted Profile, 상태이력/감사 참조, provider/email 미인증을 다시 읽기 검증하고 백업한다. 실제 Google identity가 있거나 상태가 바뀌었으면 중단한다.
2. 별도 승인 후 공식 Auth Admin updateUserById로 **점유 행의 이메일만** 충돌하지 않는 예약 주소로 변경하는 안을 우선 검수한다. Auth UUID/Profile deleted/역할/이력 참조는 보존하며 계정 삭제·복구·합병을 하지 않는다. 주소는 unique하고 수신 불가능한 예약 도메인을 사용한다. 원래 이메일은 제한된 작업 기록에 남기고 공개 repo에는 기록하지 않는다.
3. 기존 활성 태장 계정으로 로그인한 상태에서 사용자가 Google 연결을 눌러 본인 Google 인증. 연결 후 Auth UUID·활성 Profile·직원 연결·역할·이력 불변을 재확인한다. 단순히 Google 신규 로그인해서 새 계정을 만들지 않는다.
4. 연결 전 실패하면 동일 UUID에 원래 이메일을 복원 가능한지 확인한다. 이미 Google가 활성 계정에 연결된 뒤에는 이메일 점유를 다시 만들지 않으며 자동 unlink/복구를 하지 않는다. 관리자와 사용자의 실검수 후 수동 복구한다.

태장 CI의 `google-email-release-auth-integration.mjs`는 **localhost:54321 + 지정 disposable Docker DB만** 허용하고 합성 계정으로 공식 Admin API 이메일 변경 후 UUID/deleted Profile/이력/감사/다른 계정 보존을 확인한다. 실제 계정 변경 도구나 운영 실행 스크립트가 아니다. 이 시험은 Google OAuth 성공의 증거가 아니다.

현재 운영 변경은 여전히 0건. 위 단계 실행 및 실제 일정 표시 검수는 별도 승인과 사용자 Google 인증이 필요하다.
