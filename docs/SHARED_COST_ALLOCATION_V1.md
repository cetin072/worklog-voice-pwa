# Shared Infrastructure Cost Allocation V1

기준 Issue: #160
의존: #149 Usage Ledger V1

## 목적

직접 변동원가와 공통 고정비를 분리한 채 사용자·Workspace 월 총원가를 계산한다.

```text
direct_cost_krw
+ allocated_shared_cost_krw
= total_cost_krw
```

## 공통비 원장

`public.shared_cost_pools`

월별 공통 인프라 비용 원본을 저장한다.

예:

- Supabase base/database
- Netlify base/hosting
- domain
- shared storage/network/observability
- 기타 공통 서버/서비스

일반 사용자에게 원본 pool을 노출하지 않는다. trusted server/admin만 관리한다.

## V1 배분 방식

`equal_active_user`

해당 월에 Data Core에서 다음 중 하나 이상 활동한 `user_id + workspace_id`를 active pair로 본다.

- usage_events
- work_records
- schedules
- source_refs
- candidates

공통비 pool 하나를 active pair 수로 동일 배분한다.

활성 사용자가 0명인 달은 allocation을 만들지 않는다. 비용을 임의 사용자에게 강제로 배정하지 않는다.

## 배분 결과

`public.shared_cost_allocations`

- pool_id
- month_start
- user_id
- workspace_id
- allocation_method
- allocation_weight
- allocated_cost_krw

일반 authenticated 사용자는 자기 allocation만 SELECT할 수 있다. 쓰기는 허용하지 않는다.

## 재계산

`public.recalculate_shared_cost_allocations(month_start)`

- `service_role` 전용
- `security invoker`
- 같은 월을 다시 계산하면 기존 derived allocation을 지우고 같은 기준으로 다시 만든다.
- 일반 authenticated/anon은 실행 불가

## 월 총원가 read model

`public.user_monthly_cost`

- direct_cost_krw
- allocated_shared_cost_krw
- total_cost_krw
- event_count
- audio_seconds
- input/output tokens
- storage_bytes
- api_calls

`security_invoker=true` view이며 underlying RLS를 그대로 따른다.

## 실제 DB 검증

2 active users + 1 inactive user fixture:

- shared pool 100 + 200 = 300 KRW
- active users 2명 → 각 150 KRW
- direct user1=100 → total=250
- direct user2=200 → total=350
- inactive user3 allocation=0
- 재계산 2회 후 allocation row 수 동일
- user1에서 user2 allocation visibility=0
- authenticated pool 원본 SELECT=false
- authenticated allocation mutation=false
- authenticated recalc RPC EXECUTE=false
- transaction rollback 후 fixture 미잔존
- Security Advisor lint=0

## 비범위

- 실제 Supabase/Netlify 청구서 자동 수집
- 카드/결제
- 구독 플랜
- 마진/매출 계산
- MAU/유료회원/usage-weighted allocation

이들은 후속 단계에서 추가할 수 있다.
