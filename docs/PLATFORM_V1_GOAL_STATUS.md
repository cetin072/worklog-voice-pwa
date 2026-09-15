# 업무수첩 Platform V1 — Goal 상태

- 기준일: 2026-09-15
- 현재 Goal: Notion 필수 저장 구조를 Supabase Data Core 원본 + 선택형 Notion Integration 구조로 단계 전환한다.
- Source of Truth: `cetin072/worklog-voice-pwa`
- 안정 운영선: `main`
- 장기 통합선: `goal/platform-v1`
- 실제 Data Core 프로젝트: Supabase `worklog-platform` (`zlhdhwgabqzsuuhaiedc`)

## Major Gate — PR #171

- 최신 `main`: `dfa1de963d1c785ae7f8204ab3d4981f63218b75`
- 최종 기능/환경 Gate 검증 HEAD: `64cf497ee3773d4f695e436f018c69af22205777`
- main 대비: behind 0 / ahead 88 (최종 기능 Gate 시점).
- PR #171은 사용자 명시 승인 전 `main` 병합 금지.

### 최종 Gate 결과

- `npm test`: PASS — 242/242.
- GitHub UAR v2: PASS.
- Netlify exact Deploy Preview: PASS / READY.
- environment parity: PASS.
- Platform Goal Preview `/api/supabase-auth-config`: PASS.
  - `configured=true`
  - `dataCorePrimaryEnabled=true`
  - HTTPS Supabase origin
  - modern publishable key
  - public response에 server secret/service-role field 없음
- representative browser smoke: PASS.
- visual stability: PASS — mobile viewport 8 samples geometry stable.
- Netlify secret scan: no secret match.
- Production Data Core configuration: unchanged.
- Preview에 `SUPABASE_SECRET_KEY` 및 유료 Provider secret 미설정.

## Issue #182 — Preview Data Core flag-on 해결

Netlify env connector에서 신규 변수를 개별 scope 배열로 upsert했을 때 실제 env 목록에 반영되지 않는 문제가 있었다. `context=deploy-preview`, `scope=all` 방식으로 재등록하여 다음 6개가 Preview 전용으로 존재하는 것을 재확인했다.

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`
- `WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`
- `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED=true`
- `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED=true`

새 exact-head Preview에서 UAR가 endpoint를 직접 호출하여 `UAR_PREVIEW_RUNTIME_DATA_CORE_CONFIG_PASS`를 확인했다.

## Creator-only WorkRecord mutation RLS

- `restrict_work_record_mutations_to_creator` migration을 올바른 `worklog-platform`에 실제 적용 완료.
- remote/repo version: `20260915023455`.
- 실제 rollback fixture:
  - creator update = 1
  - 같은 Workspace member SELECT = 1
  - 같은 Workspace member update = 0
  - outsider SELECT = 0
  - outsider update = 0
- Supabase Security Advisor: blocking lint 0.
- Performance Advisor: 신규/저사용 DB의 unused-index INFO만 존재.

## Data Core 완료 범위

- Supabase Auth + Personal Workspace bootstrap
- Workspace / Membership RLS
- Internal Data Core repositories
- WorkRecord / Schedule / SourceRef / Candidate
- Notion Worklog Adapter 분리
- Data Core + Notion dual-write
- Data Core primary Quick Worklog
- Data Core Briefing read / creator-only status mutation
- Data Core Schedule briefing read
- ScheduleCandidate → Schedule atomic confirmation
- Usage Ledger V1 direct cost attribution
- Shared Infrastructure Cost Allocation V1
- Trusted Data Core Writer V1 server-only boundary
- migration history alignment
- UAR v2 exact-head Preview gate

## 실제 DB 검증 완료

- 신규 Auth user → Personal Workspace 1개 / owner membership 1개
- bootstrap 재호출 idempotent
- Workspace RLS 격리
- WorkRecord/SourceRef request idempotency
- creator-only WorkRecord update enforcement
- Schedule 범위/RLS
- ScheduleCandidate 원자적 확정 및 재호출 중복방지
- Usage Ledger 본인 조회 / 타 사용자 차단 / 일반 authenticated mutation 차단
- 월 direct cost rollup
- Shared Cost 일반 사용자 차단 / 본인 allocation 조회 / 타 사용자 차단
- equal_active_user 배분 및 재계산 idempotency
- `user_monthly_cost = direct + allocated shared`
- 테스트 fixture rollback 후 잔존 없음
- Security Advisor lint 0

## 실제 Supabase migration history

1. `20260914161008 personal_workspace_bootstrap`
2. `20260914161132 fix_personal_workspace_bootstrap_ambiguity`
3. `20260914161258 data_core_worklog_idempotency`
4. `20260914162801 confirm_schedule_candidate`
5. `20260915000923 data_core_usage_ledger_v1`
6. `20260915001501 shared_cost_allocation_v1`
7. `20260915001535 shared_cost_pool_explicit_deny_policy`
8. `20260915023455 restrict_work_record_mutations_to_creator`

Repo migration version/name과 remote history를 정렬했다.

## Notion 호환성 / Notion-free 경로 검증 수준

- Notion 미설정 상태의 Data Core primary save 계약 테스트: PASS.
- Data Core primary 재시도/checkpoint 계약: PASS.
- Notion Adapter payload/error 회귀 테스트: PASS.
- UAR browser smoke는 외부 write를 차단한 상태로 PASS.
- 기존 Notion 경로를 이번 Gate에서 제거하지 않는다.
- 실제 외부 Notion write나 실제 사용자 계정으로 Preview E2E write를 실행했다고 과장하지 않는다. Production cutover/활성화는 `main` 병합 이후 별도 운영 Gate다.

## 현재 결론

Platform V1 코드/DB/Preview 보안 Gate는 `main` 병합 승인 요청 단계까지 도달했다. 이 문서-only 마무리 commit도 #171 exact-head UAR를 다시 통과한 뒤 PR을 Ready for Review로 전환한다.

`main` 병합 후에도 Production Data Core feature flags / privileged secret 활성화는 별도 단계이며, Notion을 즉시 제거하지 않는다.

## 승인 필요사항

- PR #171 → `main` 병합
- destructive migration / 대량 데이터 변경
- 실제 유료 STT/AI 호출 또는 새 유료 Provider 활성화
- Production `SUPABASE_SECRET_KEY` 설정/교체 등 privileged secret 변경

## 알려진 debt

- 기존 Notion personal token localStorage 방식은 호환성을 위해 아직 유지한다.
- Trusted writer는 코드 경계만 준비했고 Production secret에는 연결하지 않았다.
- 실제 Supabase/Netlify 청구서 자동 수집 및 상용 요금/마진 계산은 후속 단계다.
