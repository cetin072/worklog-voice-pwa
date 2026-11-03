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

## 2026-11-03 KST 실제 본인 pilot 복사

승인 후 원본 snapshot을 비공개 백업하고 실제 PostgreSQL WASM 복원/동일 내용 해시 검사를 통과했다. `scripts/consolidation/verify-pilot-restore.mjs`는 네트워크·운영 credential 없이 주어진 백업과 대상 read-only migration을 검증한다. 원본 내용을 로그에 출력하지 않고 해시/개수만 비교한다.

태장 PR575의 read-only migration을 실제 적용하고 본인 공간1/업무262/일정51(확정31)/source_refs262/normalizations262 및 부속 기록을 원자적으로 복사했다. 실제 typed JSON 대조를 통과했고 entity ID와 원문·시간을 유지했다. 다른 네 명의 자료는 제외했다. 원본 데이터/모바일 서버 설정을 변경하지 않았다.

전체 RPC rehearsal SQL38개 및 쓰기/트리거 전환은 아직 운영 미적용이다. 실제 태장에는 네 dashboard 테이블 읽기만 부여하며 알림 등록 credential 조회·쓰기·발송은 차단했다. Google provider/manual linking, 이메일 점유 해소, Data API의 worklog expose, 실제 사용자 로그인과 기존 모바일의 쓰기 전환은 여전히 미완료다. 연결된 도구에 Auth Admin/설정 쓰기 및 사용자 관리자 브라우저 연결이 없어, SQL로 Auth를 직접 수정하거나 별도 공개 fallback API로 우회하지 않았다. 상세 실제 상태는 태장 docs/planning/ERP_WORKLOG_SINGLE_PROJECT_V1.md 마지막 체크포인트를 따른다.


## Google 연결 이후 모바일 전환 준비 — 2026-11-03 KST

사용자 본인의 Google identity가 기존 ERP Auth UUID에 연결된 것을 대상 서버에서 확인했다. 기존 active Profile/권한2/person link1 fingerprint와 업무262/일정51이 보존됐다. Google 연결은 완료됐으나 모바일 프로젝트 전환과 새 기록 ERP 반영은 별도 단계다. 공개 문서에 실제 사용자 식별자/원문/토큰을 넣지 않는다.

사용자의 다음 단계 진행 요청에 따라 ERP PR575에 `20261103081634_worklog_personal_write_pilot`을 준비했다. 기존 rehearsal에서 개인 저장·편집·브리핑 RPC26개와 코어 trigger8개만 복제·축소했다. source Auth/데이터 삭제·다른 사용자 이전·scheduler/Push credential·membership 자가 부여는 포함하지 않는다. 운영 적용 여부는 해당 PR 실행 기록이 기준이다.

모바일 SDK의 worklog opt-in에서 기존 프로젝트 JWT가 새 Auth/DB 서버로 전송되기 전에 issuer routing guard를 추가했다. 이는 서명/권한 인증이 아니며 실제 Supabase 검증을 대신하지 않는다. 기본 public/기존 프로젝트 경로는 유지한다. 기존 프로젝트별 SecureStore 세션/기기 원문은 삭제하지 않는다. 실제 SDK runtime 테스트는 foreign JWT 네트워크 전송0회와 same-project Auth 요청을 확인한다.

설치된 모바일 앱의 API 주소는 아직 원본이다. 이후 검수용 API에 대상 프로젝트/worklog/primary save를 맞추고 본인 기기에서 재로그인해야 한다. Netlify 기존 env key를 도구로 단순 upsert하면 기존 production context까지 바뀔 수 있으므로 컨텍스트별 override 보존을 확인하지 않은 변경을 하지 않는다. 기존 프로젝트의 관리자 credential/Notion/push 전송을 대상 검수환경에 그대로 승계하지 않는다.

실제 전환 직전 source/target 마지막 차이와 로컬 미전송 큐를 보존·검증하고 단일 쓰기 원본을 정한다. source 사용자 UUID와 target UUID가 다르므로 오프라인 소유자를 이메일/이름으로 자동 합치지 않는다. QA APK는 별도 제작 요청 시 누적 후보에서 만들며 이 준비 변경만으로 정식 앱/Play/원본 운영 설정을 바꾸지 않는다.


### 저장 서버 및 개발 API 연결

태장에 `20261103081634 / worklog_personal_write_pilot` 적용 완료. 동일 SQL의 적용 전후 공간1/업무262/일정51 내용 hash 불변, imported owner bootstrap/권한·비노출 경계를 서버에서 확인했다. 실제 본인 휴대폰 저장으로 검수한 것은 아니다.

Netlify worklog-voice-pwa의 deploy-preview context에만 SUPABASE_URL/PUBLISHABLE_KEY를 태장으로, WORKLOG_DATA_CORE_PRIMARY_ENABLED=true, WORKLOG_DATA_SCHEMA=worklog로 설정했다. 기존 dev/production/기타 context 값은 보존 후 재대조했다. 이 commit 재배포 후 실제 public config를 검증한다. 기존 관리 secret/Push credential을 이식하지 않았고 사이트/팀의 SUPABASE_SECRET_KEY 부재를 확인했다. core save는 본인 bearer + publishable key와 RLS를 사용한다.

다음 실제 기기 단계는 태장 Redirect allowlist의 `worklog-qa://google-auth` 확인, 본인용 QA API를 포함한 누적 QA 후보 제작 요청, 새 Google 로그인, 미전송 원문 보존/최종 차이 확인 및 새 기록 ID가 ERP에 나타나는지 확인이다. 정식 설치본의 API 주소는 아직 원본이며 QA APK를 자동 생성하지 않았다. source 데이터나 기기 큐를 삭제하지 않는다. 신규 target 쓰기 이후 source로 되돌릴 때에는 신규 기록을 먼저 회수·조정한다.


## 실제 모바일 저장·ERP 수용 및 전환 차이 점검 — 2026-11-03 KST

사용자가 QA 앱에서 업무2건을 등록했고, 서버의 기존 ERP UUID 소유권/RLS와 ERP reader 조건으로 조회됨을 확인한 뒤 ERP 화면 확인 완료를 회신했다. 해당 입력으로 일정1건도 생성됐다. 업무264/일정52이며 기존 ERP 계정과 개인 공간을 유지한다. 단순 snapshot 표시를 넘어 **본인 QA 앱의 새 저장→태장→ERP 표시** 수용이 완료됐다. 정식 설치본은 원본 서버이며 전체 통합/정식 출시 완료로 보고하지 않는다.

QA 검수본 source `f519ae60a5bda37dee3ce9c7ecc61ce95b1fbcfe`, 수동 run668 `41605997638`의 5개 job 모두 success. APK artifact13217721326의 ZIP digest/source metadata/실제 bundle Preview483 origin을 대조했다. 대상 allowlist의 `worklog-qa://google-auth` 저장 완료, 기존 ERP callback·Site URL 유지. 검수본 APK SHA256: `d5e390a062db4e6dc22c623955f35e13552e5b68f7e63d03905540d780993d79`.

### 재사용 가능한 비파괴 core 대조

`scripts/consolidation/personal-cutover-audit.mjs`는 SQL 실행/이전/복구 도구가 아니다. 승인된 본인 UUID와 public/worklog schema로 **SELECT fingerprint query만 생성**하며 core4 테이블(개인 공간·owner membership·업무·일정)의 명시 Auth FK만 대응 표식으로 정규화한다. 원문/metadata/시간은 비교 대상에 남긴다. 승인되지 않은 계정 FK를 숨기거나 이메일로 합치지 않는다. 출력에는 원문·토큰·push credential이 없다.

각 SQL 결과의 `snapshot`을 `comparePersonalCutover(sourceSnapshot,targetSnapshot)`에 전달한다. 같은 ID/다른 내용, 원본에만 있는 ID, 대상에만 있는 ID를 따로 보고한다. 중복 ID·누락 테이블·불완전 fingerprint·owner 공간 불일치는 중단한다. MD5는 PG JSONB의 내용 차이 점검용이며 인증/서명 수단이 아니다. 일치하더라도 기기 미저장 자료·첨부·알림이 확인된 것으로 보지 않으며 `productionReady=false`를 유지한다. 양방향 동기화/수정시각 우선 덮어쓰기/자동 삭제/승자 선택 없음.

본인 실제 core 대조 결과:

| 항목 | 원본 | 태장 | 공통 내용 일치 | 원본에만 | 태장에만 | 동일 ID 변경 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 개인 공간 | 1 | 1 | 1 | 0 | 0 | 0 |
| 본인 owner membership | 1 | 1 | 1 | 0 | 0 | 0 |
| 업무 | 262 | 264 | 259 | 0 | 2 | 3 |
| 일정 | 51 | 52 | 51 | 0 | 1 | 0 |

업무3건의 차이는 `status / updated_at / completed_at`에만 있으며 태장에서 completed로 바뀌었다. 새로운2업무/1일정과 완료3건을 원본 snapshot으로 덮으면 사용자 변경이 유실된다. 현재 core에서 원본에만 남은 행은0이나, 이것이 전체14테이블·첨부·기기 원본 이전 완료를 뜻하지 않는다. 실제 개인 식별자/제목/행 fingerprint는 공개 문서·fixture에 넣지 않았다.

실제 PostgreSQL(PGlite)로 UUID 매핑, 다른 개인 공간 제외, 동일 건수의 내용 수정 탐지, metadata 안의 사용자ID를 임의 치환하지 않는 경계, owner membership 부재를 검사했다. 전체 로컬 테스트1060/1060 통과. 이번 변경은 오프라인 감사 코드/테스트/문서이며 모바일 제품 코드가 바뀌지 않아 APK를 다시 만들지 않는다.

### 다음 전환 순서와 중단 조건

1. 사용자 확인: 기존 정식 앱의 미저장 녹음·작성 중인 글·사진 입력은 **없음**이라고 회신했다. 사용자 확인 기록이며 에이전트가 휴대폰 저장소를 직접 검사한 것은 아니다. 기존 기기 자료·세션·앱 데이터는 삭제하지 않는다. 캡처 inbox/음성 draft는 기존 사용자 범위에 보존되며 source→target UUID를 자동 재귀속하지 않는다.
2. 본인 기록은 현재 검수된 QA 앱에서 태장에 저장된다. 원본 정식 앱과 QA 앱을 같은 개인 기록의 병행 작성처로 사용하지 않는다. 재전환/롤백 전 차이 검사를 다시 실행하고 태장 추가·수정분을 보존한다.
3. 정식 앱과 공용 API 주소를 일괄 변경하면 기존 업무수첩의 다른4명에게도 영향을 줄 수 있다. 이들의 Auth/개인 공간 이전은 승인 범위가 아니다. 본인 전환 범위를 지키며 정식 배포 대상을 확정하기 전 global production config 변경을 하지 않는다. 계정 전환을 위한 다중 프로젝트 자동 fallback도 추가하지 않는다.
4. 정식 variant callback은 `worklog://google-auth`이며 이번에 저장한 QA callback과 다르다. 정식 후보를 준비할 때 실제 variant/서명/대상 API/allowlist를 함께 검증한다. 현재 정식 callback 설정 완료로 추정하지 않는다.
5. 모바일 로컬 알림과 서버 push/scheduler를 구분한다. 서버 credential·cron은 비활성 상태를 유지하고 재사용하지 않는다. 실제 전환 후보에서 중복·누락 알림을 검수하기 전 전체 알림 이전 완료로 표시하지 않는다.
6. 새 사용자 provisioning/다른 사용자 이전/main 병합/Production·Play 배포/원본 프로젝트 삭제는 이번 실행에서 하지 않았다. 원본 데이터 쓰기 잠금이나 target→source 역복사도 하지 않았다.

