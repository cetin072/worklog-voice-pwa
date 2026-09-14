# Data Core V1

기준 Issue: #122 / 구현 Checkpoint: #123

## 1. 목적

업무수첩의 구조화 데이터를 Notion 필수 저장 구조에서 자체 Data Core로 전환한다.

목표 상태:

- `Supabase Postgres` = 업무수첩 구조화 데이터의 Source of Truth
- `Notion` = 선택형 Integration / Sync
- 음성·영상·사진·PDF 원본 = Local-first
- 서버 분석이 필요한 원본 = 임시 Object Storage
- Storage Provider = Platform Storage Boundary 뒤에 위치

## 2. 전환 중 Source of Truth

전환은 Big-bang으로 하지 않는다.

1. 현재 production 사용자 흐름에서는 기존 Notion 저장을 유지한다.
2. Data Core schema와 Auth/Workspace를 먼저 검증한다.
3. Internal Repository를 추가한다.
4. 짧은 Dual-write 기간에 Supabase와 Notion 저장 결과를 비교한다.
5. 검증 후 Supabase를 구조화 데이터 Source of Truth로 승격한다.
6. 그 뒤 Notion을 선택형 Adapter/Sync로 내린다.

따라서 Data Core schema가 존재한다는 이유만으로 현재 `worklog.mts`의 Notion 경로를 즉시 제거하지 않는다.

## 3. V1 핵심 엔티티

### Workspace

업무 데이터의 소유 단위다. User와 Workspace를 분리한다.

- `personal | team | project`
- V1 role: `owner | member`
- 핵심 업무 데이터는 모두 `workspace_id`를 가진다.

### WorkRecord

현재 빠른 업무기록/직접입력/음성 기록이 수렴할 구조화 업무 기록이다.

주요 필드:

- title
- content
- original_text
- record_type
- status
- institution
- amount
- follow_up
- recorded_at
- due_at

### Schedule

`일정을 놓치지 않기` 제품 가치의 중심 엔티티다.

주요 필드:

- title / description
- starts_at / ends_at
- all_day
- timezone
- status
- location
- reminder_at

주요 조회는 `workspace_id + starts_at` 기준으로 최적화한다.

### SourceRef

업무/일정/후보가 어디에서 생겼는지 추적한다.

V1 source type:

- direct
- voice
- call
- meeting
- mail
- capture
- scan
- notion
- import
- other

`entity_type + entity_id`는 결과 객체를 가리키고, `source_type + source_id`는 원본 출처를 가리킨다.

### Candidate

AI 추출 결과는 기본적으로 확정 데이터가 아니라 Candidate다.

V1 type:

- task
- schedule
- contact
- follow_up

상태:

- pending
- confirmed
- dismissed

확정 시 실제 엔티티 ID를 연결할 수 있다. 사용자가 확인한 값은 이후 AI 재분석보다 우선한다.

## 4. 보안

- `public` Data API 테이블은 모두 RLS 필수.
- `anon`은 Data Core 테이블 권한 없음.
- `authenticated`는 명시적으로 GRANT된 최소 CRUD만 사용하며 RLS의 Workspace 격리를 받는다.
- `service_role`/`sb_secret_*`는 브라우저/모바일 클라이언트에 노출하지 않는다.
- RLS helper는 비노출 `private` schema에 둔다.
- `SECURITY DEFINER` helper는 고정 `search_path`와 제한된 EXECUTE 권한을 사용한다.
- Workspace 생성자는 owner이며, V1에서는 owner transfer를 지원하지 않는다.

## 5. 미디어 저장 원칙

Data Core DB에 대용량 원본 파일을 넣지 않는다.

- 휴대폰 원본: Local-first
- STT/OCR/AI 서버 처리용 파일: 임시 Object Storage
- 처리 완료 후 Retention/Delete 정책으로 제거
- Object Storage 공급자는 Supabase Storage로 고정하지 않는다.

## 6. 비용/사용량

기존 Platform Usage Event / Cost Gate를 사용해 사용자·Workspace 단위 원가 계산으로 확장한다.

직접 원가 후보:

- STT seconds/minutes
- AI input/output tokens
- Storage GB-hours
- Egress bytes
- Function/API calls

공통 배분 원가 후보:

- Supabase plan
- Netlify plan
- 도메인/기타 공통 인프라

Billing/결제 엔진은 Data Core V1의 비범위다.

## 7. #123 구현 범위

현재 `worklog-platform` Supabase 프로젝트에 다음 6개 테이블을 먼저 둔다.

- workspaces
- workspace_members
- work_records
- schedules
- source_refs
- candidates

Auth UI, Personal Workspace 자동 bootstrap, Dual-write, Notion Adapter 전환, Storage bucket은 후속 작은 Issue로 분리한다.

## 8. 다음 순서

1. Data Core schema + Workspace RLS — #123
2. Supabase Auth + Personal Workspace bootstrap
3. Internal WorkRecord Repository
4. Notion/Supabase Dual-write 검증
5. Supabase Source of Truth cutover
6. Notion optional Integration/Sync
7. Briefing reader를 Data Core 기준으로 전환
8. Usage/Cost 월별 사용자 원가 집계

## 9. Auth 및 Personal Workspace bootstrap (#125)

새 사용자는 Supabase Auth의 영구 사용자여야 하며, Auth 성공 직후 개인 Workspace와 owner membership을 확보한다.

- 신규 Auth user는 DB trigger가 `personal` Workspace와 `owner` membership을 생성한다.
- 로그인 후에는 `public.bootstrap_personal_workspace()` RPC를 다시 호출할 수 있다. RPC는 인자를 받아 다른 사용자를 지정하지 않고 `auth.uid()`만 사용한다.
- `workspaces(owner_user_id) where kind = 'personal'` 부분 고유 인덱스와 `workspace_members` 복합 PK가 재호출·동시 호출을 한 Workspace와 한 owner membership으로 수렴시킨다.
- public RPC는 `authenticated`에만 실행 권한을 주며, 실제 권한 상승 함수는 `private` schema와 고정 `search_path`에 둔다.
- Browser는 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`만 읽는다. service role 또는 secret key는 브라우저·Netlify 응답에 포함하지 않는다.
- WorkRecord의 Supabase 저장은 Repository/Dual-write 단계의 책임이며, Auth bootstrap 단계에서 기존 Notion 저장 경로를 대체하지 않는다.

## 10. Internal Repository boundary (#127)

- `WorkRecordRepository`, `ScheduleRepository`, `SourceRefRepository`, `CandidateRepository`는 canonical domain input과 `Workspace Context`를 받고, snake_case Supabase row는 Repository 내부에서만 만든다.
- `SupabaseDataCoreRestClient`는 publishable key와 호출자의 user JWT만 사용한다. service role/secret key를 요구하거나 보관하지 않는다.
- Repository는 저장 adapter 실패를 성공으로 바꾸지 않는다. 실제 worklog의 Notion 분리와 Dual-write는 이 경계 위의 다음 단계다.

## 11. Notion Worklog Adapter (#129)

- 기존 `worklog` HTTP function은 요청 인증, 입력 검증, schedule extraction, idempotency만 담당한다.
- Notion page 속성 매핑과 `v1/pages` 호출은 `NotionWorklogAdapter`가 담당한다.
- Adapter 분리는 Notion 저장을 제거하지 않는다. Dual-write 동안 기존 Notion 저장 결과와 오류 UX를 유지하기 위한 경계다.

## 12. Dual-write idempotency (#131)

- WorkRecord와 SourceRef는 `workspace_id + client_request_id`로 upsert 가능한 additive 고유 제약을 둔다.
- Dual-write coordinator는 Data Core와 Notion의 부분 성공 상태를 별도로 저장해, 재시도 시 완료된 writer를 다시 호출하지 않는다.
- 양쪽 저장이 모두 실패했을 때만 호출자 오류가 된다. 한쪽 성공은 상태를 보존해 남은 writer만 재시도할 수 있다.
- `WORKLOG_DATA_CORE_DUAL_WRITE_ENABLED=true`일 때에만 `worklog`가 이 경로를 사용한다. Browser가 보낸 Platform bearer token은 서버에서 `/auth/v1/user`와 `bootstrap_personal_workspace` RPC로 다시 검증하며, Data Core REST에는 그 사용자 JWT와 publishable key만 전달한다.
- 체크포인트는 `clientRequestId + verified userId` 범위로 보관한다. 한쪽만 성공하면 HTTP 오류로 원문을 유지해 같은 요청 ID 재시도가 남은 저장소만 완료한다. 플래그가 꺼져 있거나 Platform 세션이 없으면 기존 Notion 경로가 그대로 실행된다.

## 13. Data Core primary Quick Worklog (#133)

- `WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`와 유효한 Platform bearer token이 함께 있을 때, Quick Worklog의 성공 기준은 Data Core WorkRecord + SourceRef 저장이다.
- 서버는 bearer token으로 최신 Supabase user와 personal Workspace를 확인한 뒤에만 사용자 JWT로 REST write를 한다. Notion token, `APP_ACCESS_KEY`, browser session의 user object는 Data Core 권한 근거가 아니다.
- Notion 연결이 없으면 `notionSync: "not_configured"`으로 정상 완료한다. 연결돼 있지만 실패하면 Data Core result를 유지하고 `notionSync: "pending"`으로 반환한다. Data Core 실패 때는 Notion writer를 호출하지 않으므로 내부 원본 없는 Notion-only 상태를 만들지 않는다.
- primary checkpoint는 `clientRequestId + verified userId` 범위로 보관하고, retry는 성공한 Data Core writer를 다시 호출하지 않는다. 플래그-off와 비로그인 요청은 기존 Notion 저장 경로를 유지한다.

## 14. Data Core Briefing V2 read path (#135)

- `WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`와 유효한 Platform bearer token이 있을 때 `briefing-v2`는 verified personal Workspace의 열린 WorkRecord만 읽는다.
- REST query는 `workspace_id=eq.<verified workspace>`와 열린 내부 상태만 고정하고 사용자 JWT로 실행한다. RLS가 최종 Workspace 격리를 강제하며, 다른 Workspace ID를 클라이언트 입력으로 받지 않는다.
- 기존 V2 classifier를 재사용해 화면 구조를 유지한다. 현재 단계의 Data Core 행은 read-only이며, 완료 처리·undo·빠른 정리는 Notion 상태를 잘못 수정하지 않도록 숨긴다.
- 플래그-off 또는 Platform 세션이 없으면 기존 Notion Briefing V2 경로가 유지된다.
