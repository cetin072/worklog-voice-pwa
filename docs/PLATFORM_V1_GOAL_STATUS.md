# 업무수첩 Platform V1 — Goal 상태

- 기준일: 2026-09-15
- 현재 Goal: Notion 필수 저장 구조를 Supabase Data Core 원본 + 선택형 Notion Integration 구조로 단계 전환한다.
- Source of Truth: `cetin072/worklog-voice-pwa`
- 안정 운영선: `main`
- 장기 통합선: `goal/platform-v1`
- 실제 Data Core 프로젝트: Supabase `worklog-platform` (`zlhdhwgabqzsuuhaiedc`)

## 완료 Milestone

- Platform Foundation V1 공통 계약: Workspace, Processing Job/Runner, Retry, Idempotency, Usage/Cost, Storage, Adapter, Permission, Sync, Retention/Delete, Audit — `main` 반영.
- Data Core V1 핵심 schema + Workspace RLS — PR #124, `main` 반영.
- Supabase Auth + Personal Workspace bootstrap — `goal/platform-v1` 통합 및 실제 DB QA 완료.
- Internal Data Core Repository — `goal/platform-v1` 통합.
- Notion Worklog Adapter 분리 — `goal/platform-v1` 통합.
- Data Core + Notion Dual-write — `goal/platform-v1` 통합, 실제 idempotency/RLS DB QA 완료.
- Data Core primary Quick Worklog — `goal/platform-v1` 통합.
- Data Core Briefing WorkRecord read/status mutation — `goal/platform-v1` 통합, 실제 RLS mutation QA 완료.
- Data Core Schedule briefing read — `goal/platform-v1` 통합, 실제 범위/RLS QA 완료.
- ScheduleCandidate → Schedule atomic confirmation — PR #148, `goal/platform-v1` 통합 및 실제 DB QA 완료.
- UAR v2 visual stability QA Gate — `main` 및 `goal/platform-v1` 동기화.
- Data Core Usage Ledger V1 — PR #159, `goal/platform-v1` 통합 및 실제 DB/RLS/monthly rollup QA 완료.
- Shared Infrastructure Cost Allocation V1 — PR #161, `goal/platform-v1` 통합 및 실제 DB/RLS/recalculation QA 완료.
- Common Transcript V1 + Call STT Adapter — PR #156 `main` 반영, PR #162로 `goal/platform-v1` 동기화.

## 실제 Supabase 적용 상태

`worklog-platform`에 적용된 migration:

1. `personal_workspace_bootstrap`
2. `fix_personal_workspace_bootstrap_ambiguity`
3. `data_core_worklog_idempotency`
4. `confirm_schedule_candidate`
5. `data_core_usage_ledger_v1`
6. `shared_cost_allocation_v1`
7. `shared_cost_pool_explicit_deny_policy`

검증 완료:

- 신규 Auth user → Personal Workspace 1개 / owner membership 1개
- bootstrap 재호출 idempotent
- 다른 사용자 Workspace RLS 격리
- WorkRecord/SourceRef request idempotency
- ScheduleCandidate 원자적 확정 및 재호출 중복방지
- Usage Ledger 본인 조회 / 타 사용자 차단
- 일반 authenticated usage mutation 차단
- 월 direct cost rollup
- shared cost pool 일반 사용자 접근 차단
- shared allocation 본인 조회 / 타 사용자 차단
- equal_active_user 50:50 배분 fixture
- shared allocation 재계산 idempotent
- `user_monthly_cost = direct + allocated shared` 계산
- inactive user 미배분
- 테스트 데이터 rollback 후 잔존 없음
- Security Advisor lint 0

## 현재 진행 중 — Issue #163

Trusted Data Core Writer V1:

- 최신 Supabase key 기준 사용:
  - public = `SUPABASE_PUBLISHABLE_KEY`
  - server-only = `SUPABASE_SECRET_KEY` (`sb_secret_...`)
- server admin REST는 secret을 `apikey` header에만 사용하고 Bearer JWT처럼 전송하지 않는다.
- public `/api/supabase-auth-config`는 secret을 읽거나 반환하지 않는다.
- Platform Usage Event → `usage_events` authoritative writer 준비
- 같은 `(workspace,event_key)` + 동일 payload retry는 기존 row로 수렴
- 같은 event key + 다른 usage/cost payload는 fail-closed conflict
- trusted Shared Cost pool upsert / month recalculation adapter 준비
- 실제 Production secret은 아직 설정하지 않는다.

## 병렬 모듈 진행

- PR #153 — Call Usage/Cost Platform Pilot (Draft, main 미병합)
- Issue #151 / PR #156 — Common Transcript V1 + Call STT Adapter는 `main` 반영 완료.
- 실제 유료 STT/AI 호출은 아직 하지 않는다.

## 다음 순서

1. #163 Trusted Writer tests/Preview 검증 → `goal/platform-v1` 통합
2. Data Core 전체 flag-on Deploy Preview 통합 QA
3. 신규 사용자 Notion 없이 가입→기록→브리핑→일정 동작 확인
4. 기존 Notion 사용자 호환/선택형 Sync 경로 최종 점검
5. Gate A/B 충족 여부 감사
6. `goal/platform-v1 → main` Major Gate PR 생성
7. 사용자 명시 승인 후에만 main 병합

## 승인 필요사항

- `main` 병합
- destructive migration / 대량 데이터 변경
- 실제 유료 STT/AI 호출 또는 새 유료 Provider 활성화
- Production `SUPABASE_SECRET_KEY` 설정/교체 등 secret 변경

그 외 additive schema, test, adapter, docs, `goal/platform-v1` 내부 통합은 계속 진행한다.

## 알려진 debt

- 기존 Notion personal token localStorage 방식은 호환성을 위해 아직 유지한다.
- Data Core 기능은 명시적 feature flag/인증 게이트를 사용하며 Production cutover 전 통합 Preview QA가 필요하다.
- Trusted writer는 코드 경계만 준비하고 실제 Production secret에는 아직 연결하지 않았다.
- 실제 Supabase/Netlify 청구서 자동 수집과 가격/마진 계산은 후속 단계다.
