# ScheduleCandidate Confirmation V1

Issue: #143

## 목적

통화·회의·메일·캡처 등에서 생성된 `ScheduleCandidate`는 사용자가 확인하기 전까지 실제 일정이 아니다.

확정 시에는 다음 두 변경이 반드시 하나의 DB transaction으로 성공해야 한다.

1. `schedules`에 실제 일정 생성
2. 원본 `candidates`를 `confirmed`로 변경하고 생성된 Schedule ID 연결

중간 실패로 Schedule만 생기거나 Candidate만 확정되는 상태를 허용하지 않는다.

## 호출 계약

인증된 사용자 JWT로 Supabase RPC를 호출한다.

`public.confirm_schedule_candidate(p_candidate_id uuid)`

- `SECURITY INVOKER`
- existing Workspace RLS가 접근권한의 기준
- `anon` EXECUTE 없음
- `authenticated`만 EXECUTE 가능
- service role 우회 경로를 기본 계약으로 두지 않음

## ScheduleCandidate 최소 payload

Candidate 공통 필드:

- `candidate_type = schedule`
- `status = pending`
- `title` 필수

`payload`:

- `startsAt` — 필수 ISO-8601 datetime
- `endsAt` — 선택 ISO-8601 datetime
- `allDay` — 선택 boolean, 기본 `false`
- `timezone` — 선택, 기본 `Asia/Seoul`
- `status` — 선택 `confirmed | tentative`, 기본 `confirmed`
- `location` — 선택
- `description` — 선택
- `reminderAt` — 선택 ISO-8601 datetime

## 확정 결과

성공 시:

- Schedule 생성
- Schedule `workspace_id` = Candidate Workspace
- Schedule `created_by_user_id` = 확정한 현재 사용자
- Candidate `status = confirmed`
- Candidate `confirmed_entity_type = schedule`
- Candidate `confirmed_entity_id = <schedule uuid>`
- Candidate `confirmed_at` 기록

Schedule metadata에는 원본 Candidate와 SourceRef 식별자를 남긴다.

## Idempotency

동일 Candidate를 다시 확정하면 새 Schedule을 만들지 않는다.

Candidate row를 `FOR UPDATE`로 잠근 뒤 상태를 확인한다.

이미 정상적으로 confirmed 된 Candidate면 기존 `confirmed_entity_id` Schedule을 검증하고 같은 Schedule ID를 반환한다.

따라서 동시 클릭/네트워크 재시도에서도 Candidate 하나당 Schedule 하나로 수렴한다.

## 보안

클라이언트가 Workspace ID를 RPC 인자로 전달하지 않는다.

Workspace는 Candidate row에서 결정되고, Candidate SELECT/UPDATE와 Schedule INSERT 모두 기존 RLS를 통과해야 한다.

다른 Workspace 사용자는 Candidate를 조회할 수 없으므로 RPC도 `NOT_FOUND_OR_FORBIDDEN`으로 실패한다.

## 비범위

- Google Calendar 동기화
- Candidate 검수 UI
- Candidate 자동 확정
- 일정 수정/삭제
- Task/Contact/Follow-up Candidate 확정

이 기능은 향후 Call/Meeting/Mail/Capture 모듈이 같은 Schedule 계약을 소비하기 위한 공통 Data Core 경계다.
