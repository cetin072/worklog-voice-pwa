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
- 최신 main UAR v2 visual stability QA Gate — PR #158로 `goal/platform-v1` 동기화.

## 실제 Supabase 적용 상태

`worklog-platform`에 적용된 migration:

1. `personal_workspace_bootstrap`
2. `fix_personal_workspace_bootstrap_ambiguity`
3. `data_core_worklog_idempotency`
4. `confirm_schedule_candidate`
5. `data_core_usage_ledger_v1`

검증 완료:

- 신규 Auth user → Personal Workspace 1개 / owner membership 1개
- bootstrap 재호출 idempotent
- 다른 사용자 Workspace RLS 격리
- WorkRecord/SourceRef request idempotency
- ScheduleCandidate 원자적 확정 및 재호출 중복방지
- Usage Ledger 본인 조회 / 타 사용자 차단
- 일반 authenticated usage mutation 차단
- 월 direct cost rollup
- 테스트 데이터 rollback 후 잔존 0건
- Security Advisor: blocking lint 0

## 현재 진행 중 — Issue #149

Data Core Usage Ledger V1:

- `usage_events` 중앙 직접원가 원장
- `(workspace_id, event_key)` idempotency
- user/workspace/request/job/feature/service/provider/model 귀속
- STT audio seconds / AI tokens / image / storage bytes / API calls
- native cost / estimated KRW / actual KRW / pricing version
- `usage_monthly_direct_cost` 월별 사용자·Workspace 직접원가 read model
- authenticated: 본인 SELECT만 허용
- anon: 접근 불가
- mutation: trusted server writer 전용

DB migration/RLS/rollup 검증은 완료했다. 현재 GitHub migration/adapter/test를 PR로 고정하는 단계다.

## 병렬 모듈 진행

- PR #153 — Call Usage/Cost Platform Pilot (Draft, main 미병합)
- Issue #151 / PR #156 — Call·Meeting 공통 Transcript V1 + Call STT Adapter Pilot (Draft, main 미병합)
- 실제 유료 STT/AI 호출은 아직 하지 않는다.

## 다음 순서

1. #149 Usage Ledger PR 검증 → `goal/platform-v1` 통합
2. 공통 고정비 배분 V1: Supabase/Netlify/domain 등 shared cost와 direct cost 분리
3. trusted server Usage writer 연결 준비
4. Data Core 전체 flag-on Deploy Preview 통합 QA
5. 기존 Notion 사용자 호환/선택형 Sync 경로 최종 점검
6. Gate A/B 충족 여부 감사
7. `goal/platform-v1 → main` Major Gate PR 생성
8. 사용자 명시 승인 후에만 main 병합

## 승인 필요사항

- `main` 병합
- destructive migration / 대량 데이터 변경
- 실제 유료 STT/AI 호출 또는 새 유료 Provider 활성화
- Production secret/service role 설정 변경

그 외 additive schema, test, adapter, docs, `goal/platform-v1` 내부 통합은 계속 진행한다.

## 알려진 debt

- 기존 Notion personal token localStorage 방식은 호환성을 위해 아직 유지한다.
- Data Core 기능은 명시적 feature flag/인증 게이트를 사용하며 Production cutover 전 통합 Preview QA가 필요하다.
- Usage Ledger의 authoritative write는 일반 사용자 JWT가 아니라 trusted server credential 경계에서만 연결해야 한다.
- shared infrastructure cost allocation은 직접원가와 분리된 다음 Issue에서 구현한다.
