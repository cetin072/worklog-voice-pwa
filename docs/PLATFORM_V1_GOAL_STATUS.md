# 업무수첩 Platform V1 — Goal 상태

- 기준일: 2026-09-15
- 현재 Goal: Notion 필수 저장 구조를 Supabase Data Core 원본 + 선택형 Notion Integration 구조로 단계 전환한다.
- Source of Truth: `cetin072/worklog-voice-pwa`
- 안정 운영선: `main`
- 장기 통합선: `goal/platform-v1`
- 실제 Data Core 프로젝트: Supabase `worklog-platform` (`zlhdhwgabqzsuuhaiedc`)

## Major Gate 현재 상태 — PR #171

- 최신 `main`: `dfa1de963d1c785ae7f8204ab3d4981f63218b75`
- 이 문서 갱신 직전 `goal/platform-v1` / PR #171 HEAD: `136cbedaa5a9db71b1953287d9548eba9cc5f984`
- main 대비: behind 0. 최신 main 동기화 완료.
- PR #171: Draft, mergeable. 사용자 명시 승인 전 `main` 병합 금지.
- 최신 정적 회귀: `npm test` PASS (242/242).
- Netlify exact Deploy Preview build: READY / success.
- PR #188에서 Platform Goal Preview 전용 `/api/supabase-auth-config` 실검증을 UAR에 추가했다.

### Issue #182 — Preview Data Core flag-on

- 원인: Netlify env connector에서 신규 변수를 개별 scope 배열로 upsert했을 때 응답은 성공이었지만 실제 env 목록에 저장되지 않았다.
- 해결: `context=deploy-preview`, `scope=all` 방식으로 다시 등록했고 실제 Netlify env 목록에서 다음 6개가 모두 Preview 전용으로 존재하는 것을 재확인했다.
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY`
  - `WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`
  - `WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`
  - `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED=true`
  - `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED=true`
- Production context에는 위 Data Core 설정을 추가하지 않았다.
- `SUPABASE_SECRET_KEY` 및 유료 Provider secret은 Preview에도 설정하지 않았다.
- 이 문서 commit 이후 exact-head Preview/UAR를 새로 생성하여 실제 endpoint가 `configured=true`, `dataCorePrimaryEnabled=true`인지 확인한다.

### Creator-only WorkRecord mutation RLS

- `restrict_work_record_mutations_to_creator` migration을 올바른 `worklog-platform`에 실제 적용했다.
- remote migration version: `20260915023455`.
- repo migration filename도 `20260915023455_restrict_work_record_mutations_to_creator.sql`로 정렬했다.
- 실제 rollback fixture 결과:
  - creator update = 1
  - 같은 Workspace member SELECT = 1
  - 같은 Workspace member update = 0
  - outsider SELECT = 0
  - outsider update = 0
- Supabase Security Advisor: blocking lint 0.
- Performance Advisor: 신규/저사용 DB의 unused-index INFO만 존재.

## 완료 Milestone

- Platform Foundation V1 공통 계약: Workspace, Processing Job/Runner, Retry, Idempotency, Usage/Cost, Storage, Adapter, Permission, Sync, Retention/Delete, Audit — `main` 반영.
- Data Core V1 핵심 schema + Workspace RLS — PR #124, `main` 반영.
- Supabase Auth + Personal Workspace bootstrap — `goal/platform-v1` 통합 및 실제 DB QA 완료.
- Internal Data Core Repository — `goal/platform-v1` 통합.
- Notion Worklog Adapter 분리 — `goal/platform-v1` 통합.
- Data Core + Notion Dual-write — `goal/platform-v1` 통합, 실제 idempotency/RLS DB QA 완료.
- Data Core primary Quick Worklog — `goal/platform-v1` 통합.
- Data Core Briefing WorkRecord read/status mutation — `goal/platform-v1` 통합.
- Data Core Schedule briefing read — `goal/platform-v1` 통합.
- ScheduleCandidate → Schedule atomic confirmation — PR #148, 실제 DB QA 완료.
- Data Core Usage Ledger V1 — PR #159, 실제 DB/RLS/monthly rollup QA 완료.
- Shared Infrastructure Cost Allocation V1 — PR #161, 실제 DB/RLS/recalculation QA 완료.
- Trusted Data Core Writer V1 server-only boundary — PR #165, `goal/platform-v1` 통합. Production secret은 미설정.
- Common Transcript V1 + Call STT Adapter — PR #156 `main` 반영 후 `goal/platform-v1` 동기화.
- creator-only WorkRecord mutation RLS — 실제 `worklog-platform` 적용 및 격리 QA 완료.
- UAR v2 exact-head Preview / browser smoke / visual stability gate 사용 중.

## 실제 Supabase migration 상태

`worklog-platform` remote history:

1. `20260914161008 personal_workspace_bootstrap`
2. `20260914161132 fix_personal_workspace_bootstrap_ambiguity`
3. `20260914161258 data_core_worklog_idempotency`
4. `20260914162801 confirm_schedule_candidate`
5. `20260915000923 data_core_usage_ledger_v1`
6. `20260915001501 shared_cost_allocation_v1`
7. `20260915001535 shared_cost_pool_explicit_deny_policy`
8. `20260915023455 restrict_work_record_mutations_to_creator`

Repo migration version/name도 위 remote history와 정렬한다.

## 이미 검증한 실제 DB 항목

- 신규 Auth user → Personal Workspace 1개 / owner membership 1개
- bootstrap 재호출 idempotent
- Workspace RLS 격리
- WorkRecord/SourceRef request idempotency
- creator-only WorkRecord update enforcement
- Schedule 범위/RLS
- ScheduleCandidate 원자적 확정 및 재호출 중복방지
- Usage Ledger 본인 조회 / 타 사용자 차단 / 일반 authenticated mutation 차단
- 월 direct cost rollup
- Shared Cost pool 일반 사용자 접근 차단
- Shared allocation 본인 조회 / 타 사용자 차단
- equal_active_user 배분 및 재계산 idempotency
- `user_monthly_cost = direct + allocated shared`
- 테스트 fixture rollback 후 잔존 없음
- Security Advisor lint 0

## 현재 최종 Gate 순서

1. 이 문서 commit으로 PR #171 exact-head Preview 재배포.
2. UAR에서 `/api/supabase-auth-config`가 Data Core Preview 설정을 실제 반환하는지 확인.
3. `npm test` 242/242, environment parity, preview runtime, representative smoke, visual stability 재확인.
4. 기존 Notion 경로 회귀가 없는지 현재 UAR/단위계약 범위에서 재확인.
5. Issue #182를 결과와 함께 close.
6. PR #171 body와 이 상태 문서를 최종 exact HEAD 결과로 갱신.
7. PR #171을 Ready for Review로 전환.
8. 사용자 명시 승인 직전에서 중단. `main` 병합은 하지 않는다.

## 승인 필요사항

- PR #171 → `main` 병합
- destructive migration / 대량 데이터 변경
- 실제 유료 STT/AI 호출 또는 새 유료 Provider 활성화
- Production `SUPABASE_SECRET_KEY` 설정/교체 등 privileged secret 변경

## 알려진 debt

- 기존 Notion personal token localStorage 방식은 호환성을 위해 아직 유지한다.
- Notion은 즉시 제거하지 않고 선택형 Integration으로 단계 전환한다.
- Trusted writer는 코드 경계만 준비했고 Production secret에는 연결하지 않았다.
- 실제 Supabase/Netlify 청구서 자동 수집 및 상용 요금/마진 계산은 후속 단계다.
