# 실제 STT 연결 경계 V1

기준일: 2026-09-13

## 목적

이 문서는 무료 구현 단계가 끝나는 지점과 실제 외부 STT 비용·개인정보 처리가 시작되는 지점을 분리한다.

## 현재까지 코드로 준비된 것

- 통화 파일 선택 및 로컬 사전검사
- 통화 메타데이터 전달
- 통화 보고서 + 업무항목 분석 계약 V2
- STT/AI 공급자 공통 응답 정규화 계약
- STT 공급자 선택 계약 (`CALL_STT_PROVIDER`는 비밀값이 아닌 선택 ID)
- 공급자 한도 확인 게이트
- 검증된 Object Storage 직접 업로드 메타데이터 계약
- Netlify Function 본문에 대용량 음성을 싣지 않는 direct-upload 경로
- STT 1회 체크포인트와 AI/DB 재시도 시 STT 중복호출 방지
- usage event idempotency 계약
- 임시음성 삭제/만료 정책
- 개발자 2인 유료 승인 게이트

## 실제 운영 연결 흐름

```text
휴대폰에서 녹음 선택
  ↓
서버에 작은 업로드 티켓 요청
  ↓
Object Storage로 음성 직접 업로드
  ↓
서버가 업로드 존재/소유권/만료를 검증
  ↓
preparedUpload(object key + 안전 메타데이터)
  ↓
STT 어댑터 1회 실행
  ↓
녹취 체크포인트
  ↓
AI 분석 1회
  ↓
보고서 + 할 일 + 일정 + 후속조치
  ↓
결과/usage 저장
  ↓
임시음성 삭제
```

## 금지 구조

대용량 음성파일을 일반 Netlify Function request body에 넣어 `/api/call-process`로 전달하지 않는다.

클라이언트가 전달한 `objectPath`를 그대로 신뢰하지 않는다. `verifyPreparedUpload`가 저장소에서 존재·소유권·만료 등을 서버측에서 확인한 결과만 파이프라인에 넣는다.

## 실제 STT를 시작하기 전에 사람이 결정해야 하는 항목

1. STT 공급자 1개 선택
2. 선택 공급자의 최신 업로드 크기·길이·MIME·한국어/화자분리 조건 확인
3. 업무수첩 전용 Object Storage 결정
4. 업무수첩 전용 processing/usage DB 결정
5. API 키/비밀값 등록 위치 확정(Netlify 환경변수 등)
6. 개발자 2인 유료 승인
7. 개인정보/보관정책 최종 확인

## 첫 live smoke test

승인 후에도 처음에는 실제 녹음 1건만 사용한다.

- STT 호출 횟수 1회 확인
- 녹취 정확도: 이름/회사명/금액/날짜/시간 중심 확인
- provider request id와 usage event 기록 확인
- AI 분석은 같은 녹취록만 재사용
- 결과 저장 후 임시음성 삭제 확인
- 실패 재시도에서 STT 중복 과금이 없는지 확인

이 smoke test가 통과하기 전에는 여러 통화 일괄처리를 활성화하지 않는다.
