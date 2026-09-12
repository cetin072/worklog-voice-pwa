# 통화/회의 처리 재시도 규칙 V1

기준일: 2026-09-13

## 목적

네트워크/AI/DB 장애가 발생해도 이미 비용이 발생한 STT나 AI를 불필요하게 다시 호출하지 않는다.

## 체크포인트

### STT 성공 직후

`processing_jobs.transcript_checkpoint`에 녹취를 저장하고 `stt_provider_request_id`를 남긴다.

그 다음 AI 분석이 실패하더라도 재시도는 이 녹취를 사용하며 STT를 다시 호출하지 않는다.

### AI 성공 직후

정규화된 결과를 `processing_jobs.analysis_checkpoint`에 저장하고 `ai_provider_request_id`를 남긴다.

그 다음 최종 DB 저장이 실패하더라도 재시도는 이 분석 결과를 사용하며 AI를 다시 호출하지 않는다.

### 최종 결과 저장 성공 후

`calls` / `call_actions` 저장이 완료되면 `transcript_checkpoint`와 `analysis_checkpoint` 본문은 비운다. 공급자 request id는 비용 대조/장애 추적을 위해 남길 수 있다.

## 임시 음성 삭제 실패

최종 결과 저장이 성공했는데 음성 삭제만 실패하면 전체 분석을 실패로 되돌리지 않는다.

상태를 `cleanup_pending`으로 두고 삭제만 다시 시도한다.

```text
persisting
  ↓ 결과 DB 저장 성공
cleanup_pending
  ↓ 음성 삭제 성공
completed
```

`cleanup_pending`에서 STT/AI/DB 결과 생성을 다시 실행하지 않는다.

## 절대 보관 상한

임시 음성의 24시간 상한은 마지막 실패시각이 아니라 `temp_created_at`(최초 임시 업로드 시각)을 기준으로 계산한다.

따라서 재시도를 반복해도 보관기한이 계속 뒤로 밀리지 않는다.

## 사용량 원장 실패

공급자 호출은 성공했지만 `usage_events` 기록만 실패한 경우, 사용량 기록 실패 때문에 STT/AI를 다시 호출하지 않는다.

- 공급자 request id를 processing job에 보존한다.
- 처리 결과는 계속 진행한다.
- 사용량 원장 동기화/대조는 별도 재시도 대상으로 취급한다.
- 향후 공급자 Usage/Billing API가 있으면 `actual_cost_krw` 대조에 활용한다.

## 멱등성

- 사용자 + 원본파일 식별값 + 파이프라인 버전으로 `idempotency_key`를 만든다.
- `request_id`는 처리 시도 단위를 추적한다.
- `usage_events.event_key`는 같은 과금 이벤트의 중복 기록을 막는다.

이 세 키의 역할을 섞지 않는다.
