# Usage Ledger V1

기준 Issue: #149

## 목적

업무수첩의 STT/AI/Storage/API 사용량과 직접 변동원가를 사용자·Workspace 단위로 귀속한다.

이 원장은 Billing/결제 기능이 아니다. 제품 운영비와 사용자별 원가를 계산하기 위한 authoritative usage/cost ledger다.

## 저장 원칙

`public.usage_events`

- user_id
- workspace_id
- event_key
- request_id / job_id
- feature / service / operation
- provider / model / provider_request_id
- related_type / related_id
- audio_seconds
- input_tokens / output_tokens
- image_count
- storage_bytes
- api_calls
- native_cost / native_currency
- estimated_cost_krw
- actual_cost_krw
- pricing_version
- status / metadata / created_at

## Idempotency

`(workspace_id, event_key)`는 unique다.

같은 Workspace의 같은 처리 이벤트를 재시도해 원가가 중복 누적되지 않게 한다.

## 읽기 권한

- `anon`: 접근 불가
- `authenticated`: 자기 `user_id`이면서 현재 접근 가능한 Workspace의 row만 SELECT
- 일반 authenticated 사용자는 INSERT/UPDATE/DELETE 불가
- trusted server writer는 service role 또는 동등한 비공개 서버 자격증명 경계에서만 연결

service role/secret은 브라우저나 모바일 클라이언트에 노출하지 않는다.

## 월 직접원가

`public.usage_monthly_direct_cost`는 `security_invoker=true` view다.

월별 사용자·Workspace 단위로 다음을 집계한다.

- event_count
- audio_seconds
- input/output tokens
- image_count
- storage_bytes
- api_calls
- estimated_cost_krw
- actual_cost_krw
- direct_cost_krw

`direct_cost_krw`는 event별 `actual_cost_krw`가 있으면 실제값을, 없으면 `estimated_cost_krw`를 사용한다.

## Direct vs Shared Cost

이 V1은 직접 변동원가만 다룬다.

다음은 별도 shared-cost allocation 단계에서 처리한다.

- Supabase plan
- Netlify plan
- domain
- 기타 공통 서버/서비스 비용

직접원가와 공통 배분원가를 같은 값으로 섞지 않는다.

## 검증 완료

실제 `worklog-platform`에서 transaction rollback fixture로 검증했다.

- authenticated SELECT=true
- authenticated INSERT/UPDATE/DELETE=false
- anon SELECT=false
- same workspace + same event_key duplicate 차단
- different workspace + same event_key 허용
- user1에서 user2 usage visibility=0
- 월 rollup actual/estimated fallback 계산 확인
- rollback 후 usage_events=0
- Supabase Security Advisor blocking lint=0

Performance Advisor의 현재 `unused_index`는 신규 빈 DB/신규 인덱스라 아직 조회 이력이 없어 발생하는 INFO로 취급한다.
