# Platform V1 Data Core — Deploy Preview QA

기준 Issue: #172
Major Gate Draft PR: #171

## 목적

Production 환경은 그대로 둔 채 exact Netlify Deploy Preview에서 Supabase Data Core 전환 경로를 검증한다.

## Preview 전용 환경

Netlify `deploy-preview` context에만 다음을 사용한다.

- `SUPABASE_URL` → `worklog-platform` project URL
- `SUPABASE_PUBLISHABLE_KEY` → modern `sb_publishable_...` key
- `WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`
- `WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`
- `WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED=true`
- `WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED=true`

Preview에 설정하지 않는다:

- `SUPABASE_SECRET_KEY`
- 실제 유료 STT/AI provider secret

Production env/secret은 이 QA에서 변경하지 않는다.

## Gate 0 — 기본 CI/UAR

- exact PR head build
- `npm test`
- Deploy Preview ready
- UAR v2 browser smoke
- mobile visual stability
- 외부 Notion/Kakao write isolation

## Gate 1 — 공개 Auth config

`GET /api/supabase-auth-config`

확인:

- configured=true
- `supabaseUrl`은 `worklog-platform`
- `publishableKey` 존재
- `dataCorePrimaryEnabled=true`
- `secretKey`, `SUPABASE_SECRET_KEY`, `sb_secret_` 노출 없음

## Gate 2 — 신규 사용자 / Personal Workspace

전용 QA 사용자를 사용한다.

- Supabase Auth 가입/로그인
- Personal Workspace 정확히 1개
- owner membership 정확히 1개
- bootstrap 재시도 후에도 중복 없음

## Gate 3 — Notion 없는 Quick Worklog

로그인 사용자 + Data Core primary:

- Notion token 없이 저장
- `work_records` 1건 생성
- `source_refs` 연결
- 같은 clientRequestId 재시도 시 duplicate 생성 없음
- 사용자 원문이 실패 때문에 사라지지 않음

## Gate 4 — Briefing

- Data Core의 열린 WorkRecord 조회
- 다른 Workspace row 미노출
- 완료 처리
- undo 처리
- 결과가 다시 조회에 반영

## Gate 5 — Schedule

- confirmed / tentative 일정이 오늘/향후 영역에 표시
- cancelled / 범위 밖 일정 제외
- 다른 Workspace 일정 미노출
- ScheduleCandidate 확정 경계와 기존 Schedule read가 동일 Data Core를 사용

## Gate 6 — Legacy compatibility

- flag-off 코드경로의 기존 Notion 저장 계약 회귀 없음
- 기존 개인 Notion 연결정보를 자동 삭제/변경하지 않음
- Notion 미연결은 Data Core primary 사용자에게 오류가 아님

## Fixture 정리

QA용 Auth user/Workspace/WorkRecord/Schedule/SourceRef/Candidate는 검증 후 제거하거나 rollback 가능한 DB fixture를 우선한다.
실사용자 데이터는 테스트에 사용하지 않는다.

## Main Gate

이 문서의 QA가 통과해도 자동 main merge하지 않는다.
`goal/platform-v1 → main`은 사용자 명시 승인 후에만 병합한다.
