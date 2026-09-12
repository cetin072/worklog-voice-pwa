# 통화/회의 처리 파이프라인 V1

기준일: 2026-09-13

## 확정 원칙

1. 원본 녹음파일의 원본은 사용자 휴대폰이다.
2. 사용자가 선택한 녹음만 처리 서버로 보낸다.
3. 서버의 음성파일은 처리용 임시파일이며 영구보관하지 않는다.
4. 정상 처리 완료 후 임시음성은 즉시 삭제한다.
5. 실패한 작업은 재처리를 위해 기본 6시간 임시보관하고, 어떤 경우에도 24시간을 넘기지 않는다.
6. 영구 데이터는 녹취록, 요약, 핵심내용, 할 일, 일정, 후속조치, 연결 정보, 사용량/비용이다.
7. STT는 녹음 1건당 1회 수행하고 같은 녹취록으로 요약/일정/할 일을 만든다.
8. AI가 추출한 일정/할 일은 사용자 확인 전 자동 확정하지 않는다.
9. 유료 API는 두 개발자 합의 전 잠금 상태를 유지한다.
10. 현재 연결된 taejang Supabase에는 이 기능의 테이블을 생성하지 않는다. 업무수첩 전용 Supabase 프로젝트가 확정되면 적용한다.

## 처리 흐름

```text
휴대폰 원본 녹음
  ↓ 사용자가 분석 대상 선택
로컬 파일 메타데이터 확인
  ↓
processing_job 생성(request_id + idempotency_key)
  ↓
임시 Object Storage 업로드
  ↓
STT 1회
  ↓
녹취록
  ↓
AI 구조화 1회
  ├─ 통화/회의 요약
  ├─ 핵심 내용
  ├─ 할 일
  ├─ 일정 후보
  ├─ 후속조치
  └─ 참석자/고객 연결 후보
  ↓
DB 저장 성공
  ↓
임시 음성 즉시 삭제
```

## 실패 흐름

```text
업로드/전사/분석/DB 저장 실패
  ↓
job = retry_wait 또는 failed
  ↓
기본 6시간 재처리 유예
  ↓
성공하면 즉시 삭제
  ↓
최대 24시간이 지나면 무조건 삭제
```

## 데이터 모델

### processing_jobs

처리 한 번의 전체 상태를 관리한다. `request_id`와 `idempotency_key`로 중복 실행을 막는다.

핵심 필드:
- id
- request_id
- idempotency_key
- user_id
- kind(call/meeting)
- status
- source_filename
- source_contact_name
- source_phone
- source_started_at
- duration_seconds
- temp_object_path
- temp_expires_at
- attempt_count
- error_code
- error_message
- created_at / updated_at / finished_at

### calls

분석 완료 후 남기는 통화/회의 결과다. 원본 오디오는 저장하지 않는다.

핵심 필드:
- id
- job_id
- user_id
- kind
- contact_name / phone
- occurred_at / duration_seconds
- transcript
- summary
- key_points
- transcript_retention
- transcript_delete_after
- metadata

### call_actions

통화 1건에서 여러 할 일/일정/후속조치/결정을 만들 수 있게 별도 행으로 저장한다.

핵심 필드:
- id
- call_id
- user_id
- action_type(task/schedule/follow_up/decision)
- content
- due_at
- confidence
- confirmed
- source_excerpt

### usage_events

모든 유료/변동비 서비스를 한 원장에 기록한다.

핵심 필드:
- event_key (중복방지)
- request_id
- user_id
- feature
- service
- provider
- model
- audio_seconds
- input_tokens / output_tokens
- image_count
- storage_bytes
- api_calls
- estimated_cost
- actual_cost
- currency
- related_type / related_id
- status
- provider_request_id
- metadata

## 비용 집계 원칙

`feature`와 `service`를 분리한다.

예:
- feature = call_transcription, service = stt
- feature = call_summary, service = ai
- feature = meeting_summary, service = ai
- feature = document_scan, service = ocr

이 구조로 월 전체 원가, 사용자별 원가, 기능별 원가, 통화 1건 평균원가, 회의 1시간 평균원가를 계산할 수 있다.

## 녹취록 보관정책

설정에서 다음 중 하나를 선택할 수 있게 한다.

- 계속 보관
- 30일 후 삭제
- 요약 저장 후 전문 삭제

원본 음성 영구보관은 기본 기능에 포함하지 않는다.

## 아직 연결하지 않는 것

- STT 공급자 API
- AI 분석 API
- Supabase 실제 프로젝트
- Object Storage 실제 업로드
- 결제수단/API 키

위 항목은 두 개발자 합의 후 별도 작업으로 연결한다.
