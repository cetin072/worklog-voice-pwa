# 업무수첩 현재 제품 로드맵

기준일: 2026-09-19

이 문서는 현재 제품 방향과 단계 전환 승인 규칙을 한곳에 고정한다. 세부 단계 문서는 이 문서를 보완하지만, 다음 단계 착수 여부는 이 문서의 승인 게이트를 따른다.

## 1. 제품 목표

업무수첩은 단순 음성메모 앱이 아니라 개인 업무를 놓치지 않게 하는 통합 업무 허브다.

핵심 원칙:
- 입력은 빠르고 단순하게 한다.
- 같은 원본 데이터를 업무, 일정, 브리핑, 업무일지에서 재사용한다.
- 결정 가능한 것은 규칙과 코드로 처리하고 생성형 AI는 필요한 곳에만 쓴다.
- 각 모듈은 가능한 한 단독으로도 완결되며 App Shell은 모듈을 연결하는 얇은 허브로 유지한다.
- STT/OCR/Calendar/Notification/AI 같은 외부 엔진은 Adapter/Provider 경계 뒤에 둔다.
- 원본 음성·사진 등은 Local-first를 우선하고, Data Core는 권한·업무결과·동기화·복구의 기준 계층으로 사용한다.

## 2. 지금까지의 큰 흐름

### 기반 구축
- Auth / Personal Workspace / Data Core / RLS
- idempotency / retry / provider boundary / usage-cost foundation
- 기존 Notion 경로를 보존하면서 Data Core primary 경로 확장

### 모바일 실사용 기반
- Quick Voice STT와 직접입력
- Home briefing
- 일정 생성과 Calendar / Reminder 연결
- 검색 / 수정
- 회의 녹음과 로컬 라이브러리
- 실패 복구, 재진입, 기기 상태 정합성
- 모바일 Home-first UX

### Stage 3 — Action Engine + 자동 업무일지
제품 원칙:
> 브리핑은 지금 챙겨야 할 것만 보여준다.

> 업무일지는 쓰지 않아도 날짜별로 자동 완성된다.

구성:
1. 3-1 Data Contract
2. 3-2 Korean Date Engine
3. 3-3 Action Engine V1
4. 3-4 Multi-action Splitter
5. 3-5 Briefing 메모·참고 / 확인했어요 / Undo
6. 3-6 자동 업무일지 V1
7. 3-7 Note ↔ Task 수정/전환

현재 상태:
- 3-1 ~ 3-6: main 병합 완료
- 3-7: Issue #382 / Draft PR #383 검증 중
- Stage 3 종료 전 PR #383 자동검사와 회귀감사를 완료한다.
- Stage 3 완료 후보가 되면 사용자에게 보고하고 명시적 확인을 받는다.

## 3. Stage 3 완료 기준

다음이 모두 충족되어야 Stage 3 완료 후보로 보고한다.
- Task / Note / Schedule 판정과 저장 경계 유지
- 한국어 과거·현재·미래 날짜 정책 회귀 없음
- Multi-action 저장의 원본 보존·원자성·멱등성 유지
- Note 확인/Undo와 Task 완료/Undo 회귀 없음
- 업무일지가 별도 복사 원장 없이 같은 WorkRecord/Schedule에서 날짜별로 재구성됨
- Note ↔ Task 전환은 상세 수정 안에서만 제공되고 연결 Schedule은 fail-closed
- 기존 제목/기한 수정은 Stage 3-7 V2 migration 배포 전에도 계속 동작
- UAR / 관련 runtime tests / Mobile typecheck / Metro / Android smoke / ARM64 build gate 확인
- Production DB migration 또는 실사용 데이터 변경은 별도 승인 없이는 수행하지 않음

## 4. Stage 3 → Stage 4 승인 게이트

Stage 3 자동검증이 끝나도 Stage 4 코드를 바로 시작하지 않는다.

순서:
1. Stage 3 완료 후보 보고
2. 사용자 확인 / 수락
3. Stage 4 사전 브리핑
   - 현재 실사용 문제
   - 기존 브리핑·알림·일정 기능의 중복과 빈틈
   - 웹/모바일 UX 및 필요한 외부 사례 벤치마킹
   - 기존 코드와 재사용 가능한 자산
   - 비용·보안·Android/배터리·알림 제약
4. Stage 4 제품 목표와 비목표 재설계
5. 사용자 검토 / 수정 / 최종 수락
6. 수락 후에만 Stage 4 Issue → Branch → PR 개발 시작

## 5. Stage 4의 현재 위치

현재 후보 주제는 **Never Miss / 능동형 브리핑·후속조치**이지만 아직 최종 설계가 아니다.

Stage 3가 확정되기 전에는:
- Stage 4 기능 목록을 확정하지 않는다.
- Snooze, 반복 리마인드, 우선순위 재설계, 자동 에스컬레이션 등을 미리 구현하지 않는다.
- 기존 알림/브리핑 코드를 대규모로 재작성하지 않는다.

Stage 3 수락 후 새 브리핑에서 필요성을 다시 판단한다.

## 6. 장기 확장 축

Stage 4 이후에도 다음 모듈은 standalone-first 원칙으로 확장한다.
- 통화녹음 → STT → 통화보고서 → 후속업무
- 회의녹음 → 회의록 → 결정·할 일·일정
- 문서 스캔 / PDF / OCR
- 메일·캡처 입력 → 일정·업무 후보
- CRM / 고객·연락처 업무 연결
- 보고서·문서 생성 및 업무 결과 공유

각 모듈은 먼저 자체 입력→처리→결과를 완성하고, 이후 선택적으로 Data Core / Schedule / Briefing과 연결한다.

## 7. 승인 규칙

- Stage 3-7 PR #383은 사용자 승인 전 main 병합하지 않는다.
- Production DB migration은 코드 merge와 별도 승인·적용·검증 단계로 취급한다.
- Stage 4는 Stage 3 사용자 수락 전 개발하지 않는다.
- Stage 4는 브리핑과 재설계가 사용자에게 수락된 뒤에만 구현한다.
