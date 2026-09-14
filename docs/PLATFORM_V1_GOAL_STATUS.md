# 업무수첩 Platform V1 — Goal 상태

- 기준일: 2026-09-14
- 현재 Goal: Notion 필수 저장 구조를 Supabase Data Core 원본 + 선택형 Notion Integration 구조로 단계 전환한다.
- 통합 브랜치: `goal/platform-v1` (latest `main` 확인 커밋: `8768afbb54d20ac91bc48e4a802cae234a5fa6e3`)

## 완료 Milestone

- Data Core V1 schema 및 Workspace RLS: Issue #123 / PR #124, `main` 반영.
- Platform Foundation V1 최소 계약: `main` 반영.

## 진행 중

- Issue #125 — Supabase Auth + Personal Workspace bootstrap (PR #126을 `goal/platform-v1`에 통합).
  - 신규 Auth user trigger와 인증된 재시도 RPC migration을 추가했다.
  - Browser Auth adapter와 최소 로그인 UI를 추가했다.
  - 실제 `worklog-platform` migration apply, Auth provider/redirect 설정, RLS 실환경 QA는 아직 미검증이다.
- Issue #129 — Notion Worklog Adapter 분리 (PR #130을 `goal/platform-v1`에 통합).
  - `worklog`에서 Notion page 속성 매핑과 API 호출을 분리했다.
  - 기존 owner/personal Notion 저장과 idempotency 동작은 유지한다.
- Issue #131 — Data Core + Notion Dual-write.
  - Quick Worklog는 명시적 feature flag와 검증된 Platform bearer 세션이 있을 때만 Data Core와 Notion에 함께 저장한다.
  - Data Core는 사용자 JWT로 개인 Workspace를 재확인하며, `clientRequestId + userId` 체크포인트와 Data Core upsert로 부분 성공 뒤의 재시도를 수렴시킨다.
  - 실제 `worklog-platform` migration apply, RLS/Advisor 및 Preview 실환경 QA는 아직 미검증이다.

## 다음 Issue

1. #125/#131 migration을 `worklog-platform`에 적용하고 signup/retry/다른 사용자 격리/RLS Advisor를 검증한다.
2. Deploy Preview에서 flag-off 기존 Notion 저장과 flag-on dual-write/부분 실패 재시도를 비교 QA한다.
3. Notion을 선택 Integration으로 낮추는 read path와 migration 계획을 다음 작은 Issue로 분리한다.

## Blocker

- `worklog-platform`의 Supabase project 연결 정보/CLI 연결이 이 저장소에 없다. 실제 migration apply와 Auth 설정은 project 권한이 준비된 별도 검증 단계에서 수행한다.
- 실제 유료 STT/AI 호출은 승인 전 실행하지 않는다.

## 승인 필요사항

- Main merge는 Major Gate 전까지 요청하지 않는다.
- Supabase production migration apply는 별도 Preview/DB QA와 함께 수행한다.
- 유료 STT/AI provider 호출은 사용자 승인이 필요하다.

## 검증 결과

- `npm test`: PASS (192 tests, 2026-09-14).
- `node --check` 및 Netlify Function esbuild bundle check: PASS.
- DB migration/RLS Advisor: project 연결 미구성으로 실행 전.
- Last verified implementation commit SHA: `c7d7aef1e293ff2b782d3006df3712fab41f9c62` (#131 implementation; status-only follow-up commit 제외).

## 알려진 debt

- Dual-write는 DB migration과 `WORKLOG_DATA_CORE_DUAL_WRITE_ENABLED=true`를 모두 갖춰야 활성화된다. 그 전에는 기존 Notion 저장 UX가 그대로 유지된다.
- 기존 Notion personal token localStorage 방식은 호환성을 위해 이번 단계에서 제거하지 않는다.
