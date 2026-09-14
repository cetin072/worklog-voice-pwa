# 업무수첩 Platform V1 — Goal 상태

- 기준일: 2026-09-14
- 현재 Goal: Notion 필수 저장 구조를 Supabase Data Core 원본 + 선택형 Notion Integration 구조로 단계 전환한다.
- 통합 브랜치: `goal/platform-v1` (latest `main` 확인 커밋: `8768afbb54d20ac91bc48e4a802cae234a5fa6e3`)

## 완료 Milestone

- Data Core V1 schema 및 Workspace RLS: Issue #123 / PR #124, `main` 반영.
- Platform Foundation V1 최소 계약: `main` 반영.

## 진행 중

- Issue #125 — Supabase Auth + Personal Workspace bootstrap.
  - 신규 Auth user trigger와 인증된 재시도 RPC migration을 추가했다.
  - Browser Auth adapter와 최소 로그인 UI를 추가했다.
  - 실제 `worklog-platform` migration apply, Auth provider/redirect 설정, RLS 실환경 QA는 아직 미검증이다.
- Issue #127 — Internal Data Core repositories.
  - WorkRecord/Schedule/SourceRef/Candidate repository contract와 Supabase REST adapter를 추가했다.
  - 기존 worklog의 Notion 호출 분리와 Dual-write는 아직 시작하지 않았다.

## 다음 Issue

1. #125 migration을 `worklog-platform`에 적용하고 signup/retry/다른 사용자 격리/RLS Advisor를 검증한다.
2. #127을 `goal/platform-v1`에 통합한다.
3. Notion 직접 저장을 Adapter로 분리한 뒤 Dual-write 비교 QA를 시작한다.

## Blocker

- `worklog-platform`의 Supabase project 연결 정보/CLI 연결이 이 저장소에 없다. 실제 migration apply와 Auth 설정은 project 권한이 준비된 별도 검증 단계에서 수행한다.
- 실제 유료 STT/AI 호출은 승인 전 실행하지 않는다.

## 승인 필요사항

- Main merge는 Major Gate 전까지 요청하지 않는다.
- Supabase production migration apply는 별도 Preview/DB QA와 함께 수행한다.
- 유료 STT/AI provider 호출은 사용자 승인이 필요하다.

## 검증 결과

- `npm test`: PASS (186 tests, 2026-09-14).
- `node --check` 및 Netlify Function esbuild bundle check: PASS.
- DB migration/RLS Advisor: project 연결 미구성으로 실행 전.
- Last verified implementation commit SHA: `19a2d15a756a8393d15c0dcdca830a8d19ebc1da`.

## 알려진 debt

- 신규 Platform Auth 세션은 준비됐지만 WorkRecord의 Supabase 저장은 다음 Repository 단계 전까지 연결하지 않는다. 기존 Notion 저장 UX는 그대로 유지한다.
- 기존 Notion personal token localStorage 방식은 호환성을 위해 이번 단계에서 제거하지 않는다.
