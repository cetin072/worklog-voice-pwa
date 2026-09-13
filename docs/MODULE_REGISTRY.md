# 업무수첩 Module Registry V1

## 문서 상태

- 상태: **초안 / 종합기획 검토 필요**
- 기준일: 2026-09-13
- 상위 기준: `PROJECT_CHARTER.md`, `docs/MODULE_ARCHITECTURE_V1.md`, `docs/PLATFORM_FOUNDATION_V1.md`
- 목적: 업무수첩의 각 모듈이 무엇을 소유하고, 현재 어디까지 구현됐으며, 어떤 공통 계약·Platform Service·Adapter에 의존하는지 한눈에 관리한다.

이 문서는 기능 요구사항 전체를 적는 백로그가 아니다. 모듈 경계와 현재 제품 상태를 관리하는 Registry다. 상세 구현은 각 Issue/PR에서 관리한다.

---

# 1. 상태 표기

- **MAIN / 실사용**: main 및 실제 운영 흐름에 반영됨.
- **PARTIAL / 부분 기능**: 일부 기능은 main에 있으나 독립 모듈 완료조건을 만족하지 못함.
- **DRAFT / 개발 중**: Draft PR/Preview에서 개발·검수 중이며 main 기준 기능이 아님.
- **PLANNED / 기획**: 제품 방향에는 포함되지만 독립 구현이 아직 시작되지 않음.

`DRAFT`는 완성이나 배포를 의미하지 않는다. 특히 stacked PR은 선행 PR과 함께 검수해야 하며 main의 사실과 구분한다.

---

# 2. 전체 Registry

| 모듈 | 현재 상태 | 독립 핵심 Result | 공통 Candidate | 주요 Platform Service | 외부 Adapter / Processor | 현재 우선순위 |
|---|---|---|---|---|---|---|
| 빠른 업무기록 | MAIN / 실사용 | 기존 업무기록 결과, 내부 Result 계약은 정식 명명 필요 | Task / Schedule / FollowUp 일부 연결 | Auth/Permission 현행, 향후 Workspace Context / Sync | Notion Worklog Adapter, Web Speech | **P0** |
| 일정 | PARTIAL / 독립 모듈 미완성 | `Schedule` / 일정 화면 계약 정식화 필요 | `ScheduleCandidate` | Workspace Context / Sync / Conflict / Audit | Google Calendar Adapter(향후) | **P0 — 놓치지 않는 일정이 제품 최우선 가치** |
| 통화정리 | DRAFT / 개발 고도화 중 | `CallReport` | Task / Schedule / Contact / FollowUp | Storage / Processing Job / Retry·Idempotency / Usage·Cost / Retention | STT Adapter / AI Adapter / 향후 CRM·Calendar | **P0** |
| 문서 스캔/PDF | DRAFT / 개발 중 | `ScanDocument` | 기본 없음, OCR/AI 확장 시 별도 | Local Storage / Storage Adapter(선택) / Export | 기기 카메라·갤러리 / OCR은 선택 Processor | **P0~P1** |
| 브리핑 | MAIN / 실사용 | `BriefingView` 성격의 읽기 결과, 정식 Result 계약은 추후 | 직접 Candidate 생성보다 Confirmed 업무/일정 조회 중심 | Workspace Context(향후) / Sync read / Audit 일부 | 현재 Notion / Kakao Delivery | **P1** |
| 회의정리 | PLANNED | `MeetingReport` | Task / Schedule / Contact / FollowUp | Storage / Processing Job / Usage·Cost / Retention | STT / AI | **P1** |
| 메일 업무화 | PLANNED | `MailAnalysis` | Task / Schedule / Contact / FollowUp | Auth/Permission / Processing Job(필요 시) | Gmail/메일 Connector / AI | **P1~P2** |
| 캡처 분석 | PLANNED | `CaptureAnalysis` | Task / Schedule / Contact / FollowUp | Local Storage / Processing Job(필요 시) / Usage·Cost | OCR / AI | **P1 — 일정 유입 경로로 중요** |
| CRM | PLANNED | `Contact`/`Customer` 영역 Result 정식화 필요 | `ContactCandidate`, FollowUp 연결 | Workspace Context / Permission / Sync / Conflict / Audit | 외부 CRM은 향후 Adapter | **P1~P2** |

우선순위는 구현 순서를 절대 고정하는 값이 아니라 현재 제품가치와 플랫폼 의존성을 나타낸다.

---

# 3. 모듈별 기준

## A. 빠른 업무기록

### 사용자 가치
말하거나 직접 입력한 업무를 최대한 빠르게 잃지 않고 기록한다.

### 현재 상태
**MAIN / 실사용.** 현재 제품의 가장 성숙한 핵심 흐름이다.

현재 main에는 음성/직접입력, 여러 업무 분리, 날짜·시간 구조화, Notion 저장, 실패 시 입력 보존 등이 이미 존재한다. 현재 운영 업무기록의 실제 원장은 Notion `🎙 업무 통합 기록`이다.

### 독립 완료선
`말하기/직접입력 → 내용 확인 → 빠른 저장 → 즉시 수정 가능 → 실패 시 원문 보존`

### Platform Foundation 대조
- 오타·음성인식 오류가 있어도 의미가 전달되면 기록을 막지 않는다.
- 직접 명시한 일정/업무는 낮은 위험이면 빠르게 저장 가능하다.
- 현재 Notion 종속 부분은 정상 작동을 깨지 않는 범위에서 점진적으로 Worklog Adapter 뒤로 이동한다.
- Workspace 도입 시 기존 개인 사용 흐름을 복잡하게 만들지 않는다.

### 주의
정상 작동 중인 현재 음성 기록을 Platform Foundation 도입만을 이유로 전면 재작성하지 않는다.

---

## B. 일정

### 사용자 가치
**일정을 놓치지 않는 것이 제품의 최우선 가치 중 하나다.**

일정 유입 경로는 장기적으로 다음을 포함한다.
- 사용자가 직접 말함
- 직접 입력
- 통화에서 추출
- 회의에서 추출
- 메일에서 추출
- 카카오톡/문자 캡처에서 추출

### 현재 상태
**PARTIAL.** main에는 음성 입력의 날짜·시간을 구조화해 Notion 기한으로 저장하는 기능과 브리핑에서 일정성 정보를 보여주는 흐름이 있다. 그러나 업무수첩 자체의 독립 일정 모듈/일정 저장소/일정 화면은 아직 완성되지 않았다.

### 목표 핵심 흐름
`직접 일정 입력 또는 ScheduleCandidate → 확인/수정 → 업무수첩 일정 저장 → 알림/브리핑 → 선택적 Google Calendar 전송`

### 공통 계약
- `ScheduleCandidate`: AI/문맥 추출 제안
- `Schedule`: 사용자 명시 입력 또는 Confirmed 일정
- `SourceRef`: 통화/회의/메일/캡처 등 출처

### 중요한 UX
- 사용자가 직접 `내일 3시 김대리 전화 일정 잡아줘`라고 한 경우 불필요한 재확인을 최소화한다.
- 통화/회의/메일에서 추론한 일정은 기본 Candidate로 보여준다.
- 수정 버튼은 결과 가까이에 둔다.

### 아직 결정/구현 필요한 것
- 업무수첩 내부 일정의 정식 Result/DB 계약
- 알림 방식
- 반복 일정
- Google Calendar 단방향 Adapter 1차 범위
- Timezone/충돌 정책의 일정 도메인 적용

---

## C. 통화정리

### 사용자 가치
휴대폰에 이미 저장된 통화녹음을 선택해 중요한 통화만 정리하고, 녹취·보고서·업무·일정·후속조치 후보를 만든다.

### 현재 상태
**DRAFT / 고도화 중. main 미반영.**

주요 개발 흐름:
- Issue #58 / PR #59: 통화녹음 선택·분류
- Issue #74 / PR #75: Android 직접 파일선택 UX
- Issue #78 / PR #79: 모의 분석 검수 UX V2
- Issue #80 / PR #81: CallReport V1 + STT 연결 직전 준비
- 관련 기반 PR #62/#64/#66/#68/#70/#72 등

PR #81 기준으로 실제 STT/AI 공급자 호출, 실제 Object Storage, 실제 중앙 Usage DB, API Key, 유료 처리 승인은 아직 의도적으로 연결하지 않았다.

### 독립 완료선
`통화녹음 선택 → STT → 전체 녹취 → CallReport → 사용자 검수/수정 → 로컬 결과 보존/공유`

업무/일정/CRM 연결 실패가 `CallReport`를 파괴하면 안 된다.

### Result / Candidate
- Result: `CallReport`
- Candidate: `TaskCandidate`, `ScheduleCandidate`, `ContactCandidate`, `FollowUpCandidate`
- 출처: Call `SourceRef`

### 공통 플랫폼으로 승격 검토할 기존 통화 코드
통화 stacked PR에 이미 만들어진 다음 기반은 **통화 전용 표준으로 굳히지 않고 Platform Foundation과 대조한다.**
- Processing Job
- Retry / Idempotency
- Usage / Cost Ledger
- Retention/Delete
- STT/AI Adapter Contract
- Storage prepared-upload 경계

공통 계약과 일치하는 부분은 별도 Platform Foundation 구현에서 재사용/이관하고, 통화 모듈은 소비자 역할로 정리하는 것이 목표다.

### 현재 위험
깊은 stacked PR 구조가 존재한다. 개별 브랜치를 그대로 순서대로 main에 병합하기보다 Platform Foundation 확정 후 integration checkpoint를 잡아 stack을 얕게 재정리할 필요가 있다.

---

## D. 문서 스캔 / PDF

### 사용자 가치
카메라로 새로 촬영하거나 **이미 갤러리에 찍어둔 문서 사진을 빠르게 가져와 스캔**하고 여러 장 PDF로 저장/공유한다.

### 현재 상태
**DRAFT / main 미반영.**

- Issue #49 / PR #60: 1장 스캔 + Notion 첨부 V1
- Issue #82 / PR #83: 갤러리 우선 + 여러 장 + PDF 저장/공유
- PR #84: Preview QA 전용

### 독립 완료선
`갤러리 선택 또는 카메라 촬영 → 모서리/보정 → 페이지 관리 → PDF → 로컬 저장/공유`

OCR과 Notion은 필수 성공조건이 아니다.

### Result / Candidate
- Result: `ScanDocument`
- 기본 Candidate 없음
- 향후 OCR/AI 문서분석이 붙으면 별도 Candidate를 무리하게 만들기보다 기존 Task/Schedule Candidate로 연결 가능

### 플랫폼 의존성
가능한 처리는 브라우저/기기 로컬에서 수행한다. Cloud Storage는 백업/동기화 또는 서버 Processor가 필요한 경우에만 선택적으로 사용한다.

### 현재 우선 검수
갤러리 우선 UX가 실제 삼성 Android에서 편한지, 다중 페이지 순서/수정/PDF 공유가 안정적인지 확인한다.

---

## E. 브리핑

### 사용자 가치
오늘 놓치면 안 되는 업무, 지난 업무, 기다리는 일, 후속조치를 한 화면에서 확인한다.

### 현재 상태
**MAIN / 실사용.** 브리핑 2.0은 main에 반영돼 있고, 업무명 즉시 수정 등 후속 개선도 main에 반영됐다.

### 현재 데이터 관계
현재는 Notion의 업무기록을 읽어 규칙 기반으로 분류하는 비중이 크다. Kakao 전달 기능도 별도 Delivery 경로로 존재한다.

### 독립 역할
브리핑은 새로운 업무 원장을 소유하는 모듈이 아니라 Confirmed 업무/일정/후속조치의 읽기 모델(View)에 가깝다.

### Platform Foundation 대조
장기적으로 Notion 직접 모델에 묶이지 않고 Worklog/Schedule 표준 계약을 읽도록 이동한다. 그러나 현재 정상 기능을 전면 재작성하지 않는다.

---

## F. 회의정리

### 현재 상태
**PLANNED.** 독립 구현 Issue/PR은 아직 없다.

### 목표 흐름
`회의 녹음 선택/녹음 → STT → MeetingReport → 수정/보존/공유 → Task/Schedule/Contact/FollowUp Candidate`

### 재사용 원칙
통화정리와 STT/Storage/Processing Job/Usage·Cost/Retention을 공유한다. `CallReport`와 `MeetingReport`의 도메인 내용은 별개로 유지한다.

---

## G. 메일 업무화

### 현재 상태
**PLANNED.** 독립 구현 Issue/PR은 아직 없다.

### 목표 흐름
`메일 Connector → 필요한 메일 선택/조회 → MailAnalysis → 업무/일정/후속조치 Candidate`

원본 이메일의 원장은 Gmail/메일 공급자이며 업무수첩은 `SourceRef`로 원본을 참조한다.

### 초기 원칙
- 읽기/분석 중심으로 시작
- 최소 OAuth Scope
- 자동 메일 발송은 별도 고위험 Delivery 기능으로 취급

---

## H. 캡처 분석

### 현재 상태
**PLANNED.** 독립 구현 Issue/PR은 아직 없다.

### 사용자 가치
카카오톡/SMS 등 화면 캡처에서 약속·날짜·할 일을 찾아 일정 누락을 줄인다.

### 목표 흐름
`갤러리/공유로 캡처 입력 → OCR/기기 처리 → CaptureAnalysis → Schedule/Task/Contact/FollowUp Candidate`

### 우선순위 메모
사용자의 최우선 가치인 `일정을 놓치지 않기`와 직접 연결되므로, 일정 모듈의 기본 계약이 잡힌 뒤 비교적 높은 우선순위로 검토한다.

---

## I. CRM

### 현재 상태
**PLANNED.** 통화 Draft에는 연락처 후보 개념이 있으나 독립 CRM 모듈은 아직 없다.

### 역할
- 고객/연락처의 Workspace 기준 데이터
- 담당자 User는 별도
- 통화/회의/메일에서 나온 `ContactCandidate`를 기존 고객과 연결하거나 신규 후보로 제안
- FollowUp/일정/업무와 관계 연결

### 주의
AI가 이름이 비슷하다는 이유만으로 고객을 자동 병합하지 않는다. 고객 병합은 고위험 변경으로 사용자 확인을 요구한다.

---

# 4. 공통 Platform Service와 모듈 소비 관계

| Platform Service | 1차 소비 모듈 | 비고 |
|---|---|---|
| Workspace Context | 전 모듈 | 개인 UX에서는 복잡성을 숨김 |
| Auth / Permission | 전 모듈 | Closed Beta 전에 실제 다중사용자 격리 필요 |
| Storage Service | 통화, 회의, 선택적 스캔/캡처 | 원본 영구보관 기본 아님 |
| Processing Job | 통화, 회의, OCR/AI 처리 모듈 | 도메인 보고서 형식은 소유하지 않음 |
| Retry / Idempotency | 통화, 회의, 외부 연동 | 중복 비용·중복 일정 생성 방지 |
| Usage / Cost | STT/AI/OCR/Storage 사용 모듈 | workspace_id + user_id |
| Sync State / Conflict | 일정, CRM, 공유 결과, 다기기 결과 | V1은 revision 수준 |
| Retention / Delete | 통화/회의 녹취, 사용자 결과 | 24h 임시파일과 30일 휴지통 구분 |
| Audit / Event Log | 삭제, 권한, 외부전송, CRM 병합 등 | V1 최소 기록 |

---

# 5. Adapter / Processor Registry

| 경계 | 현재/목표 상태 | 소비 모듈 |
|---|---|---|
| Worklog / Notion Adapter | 현재 Notion 운영 원장을 유지하되 도메인 직접종속 축소 | 업무기록, 브리핑, 선택적 각 모듈 |
| Calendar Adapter | 아직 독립 구현 전. 초기 단방향 우선 | 일정 및 Candidate 생성 모듈 |
| STT Adapter | 통화 Draft에 계약 존재, 실제 Provider 미연결 | 통화, 회의 |
| AI Adapter | 통화 Draft에 계약 존재, 실제 Provider 미연결 | 통화, 회의, 메일, 캡처 |
| Storage Adapter | 통화 Draft에 prepared-upload 계약 존재, 실제 업무수첩 Storage 미연결 | 통화, 회의, 선택적 OCR |
| Kakao Delivery | 기존 브리핑 전달 경로 실사용 | 브리핑 |
| Gmail/Mail Connector | 미구현 | 메일 업무화 |
| CRM Adapter | 업무수첩 내부 CRM 이후 필요 시 외부 CRM 연결 | CRM |

---

# 6. 현재 우선 실행 순서

Registry 기준으로 당장의 제품개발 축은 다음처럼 본다.

1. **Platform Foundation 문서 + Module Registry 최종 확정**
2. **공통 플랫폼 최소 기반**: Workspace Context, Job, Retry/Idempotency, Usage/Cost, Storage/Adapter 경계
3. **현재 Draft 통화 stack을 공통 플랫폼 기준에 맞춰 얕게 재정리**하고 실제 STT 연결 전 Gate 검수
4. **스캔/PDF 독립 도구 완성**: 갤러리 우선, 다중 페이지, 저장/공유
5. **일정 모듈의 업무수첩 내부 기준 확정**: Schedule/ScheduleCandidate와 빠른 수정 UX
6. 일정 입력 경로 확장: 통화 → 회의/캡처/메일 순으로 Candidate 연결

단, 이미 main에서 실사용 중인 빠른 업무기록과 브리핑의 안정성 회귀는 모든 단계에서 우선 보호한다.

---

# 7. V1에서 하지 않는 것

- 모든 PLANNED 모듈을 동시에 개발하지 않는다.
- 기존 main 기능을 모듈화 명분으로 전면 재작성하지 않는다.
- 통화 stacked PR의 공통 기반을 검토 없이 전체 플랫폼 표준으로 확정하지 않는다.
- 완전한 실시간 다기기 공동편집을 만들지 않는다.
- 기업용 세분 권한/복잡한 Billing을 개인 V1보다 먼저 만들지 않는다.
- 특정 Notion/STT/AI/Cloud Provider를 도메인 모델의 기준으로 삼지 않는다.

---

# 8. 다음 검토 항목

이 초안에서 종합기획으로 확인할 것은 다음이다.

- 모듈 목록 자체에 빠진 독립 도구가 있는가
- `일정`을 P0 독립 모듈로 두는 것이 맞는가
- 통화와 스캔의 현재 우선순위가 맞는가
- 브리핑을 독립 원장 모듈이 아니라 읽기/View 모듈로 보는 것이 맞는가
- `업무기록`의 내부 Result 계약 이름을 별도로 확정할 필요가 있는가
- Platform Foundation 최소 구현 후 통화 stack을 어떤 integration checkpoint로 재정리할 것인가

사용자 검토·확정 전 이 문서를 main 기준으로 취급하지 않는다.
