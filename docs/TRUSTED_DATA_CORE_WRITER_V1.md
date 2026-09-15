# Trusted Data Core Writer V1

기준 Issue: #163
의존: #149 Usage Ledger / #160 Shared Cost Allocation

## 목적

Data Core의 authoritative Usage/Cost 원장은 일반 사용자 브라우저가 직접 쓰지 않는다.

```text
Browser / App
  → publishable key + user JWT + RLS

Trusted Netlify Function / server worker
  → SUPABASE_SECRET_KEY
  → usage_events / shared_cost_pools / recalc RPC
```

## Supabase key 기준

신규 privileged server 코드는 최신 Supabase API key 체계를 사용한다.

- Public client: `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`)
- Trusted backend: `SUPABASE_SECRET_KEY` (`sb_secret_...`)

secret key는 RLS를 우회하므로 서버 밖으로 노출하면 안 된다.
Legacy `service_role` key를 새 코드의 기본 의존으로 추가하지 않는다.

## HTTP 인증 방식

새 `sb_secret_...` key는 JWT가 아니다.
REST 요청에서는 `apikey` header에만 전달한다.
`Authorization: Bearer sb_secret_...`로 보내지 않는다.

## Usage writer

`createTrustedUsageWriter()`:

1. Platform `Usage Event V1`을 정규화한다.
2. Data Core `usage_events` row로 변환한다.
3. `(workspace_id,event_key)` 기준으로 insert를 시도한다.
4. 이미 존재하면 기존 row를 조회한다.
5. 동일 payload면 retry/idempotent success로 수렴한다.
6. 같은 event key인데 usage/cost payload가 다르면 `DATA_CORE_USAGE_EVENT_CONFLICT`로 fail-closed 한다.

Retry 시 `created_at` 차이는 사용량 의미 충돌로 보지 않는다. 사용량/소유권/비용 값은 일치해야 한다.

## Shared Cost admin

`createTrustedSharedCostAdmin()`:

- 월별 `shared_cost_pools` upsert
- `recalculate_shared_cost_allocations(month)` RPC 호출

일반 authenticated 사용자는 pool 입력이나 재계산을 실행할 수 없다.

## Secret 노출 방지

공개 endpoint `/api/supabase-auth-config`는 기존대로 다음만 반환한다.

- Supabase URL
- publishable key
- 공개 가능한 feature state

`SUPABASE_SECRET_KEY`를 읽거나 반환하지 않는다.
테스트에서도 secret env가 존재할 때 공개 JSON에 값 또는 `secretKey` 필드가 포함되지 않는지 확인한다.

## 활성화 상태

이 V1은 credential boundary/readiness 단계다.

아직 하지 않는다:

- Netlify Production에 실제 `SUPABASE_SECRET_KEY` 설정
- 실제 운영 Usage writer 활성화
- 실제 shared invoice 자동수집
- 브라우저 privileged client

Production secret 연결은 별도 승인 게이트에서 수행한다.
