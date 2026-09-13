# 업무수첩 Module Registry V1

## 문서 상태

- 상태: **우선순위 확정 / 내용 검수 완료 / exact-commit Preview 재검증 중**
- 기준일: 2026-09-13
- 상위 기준: `PROJECT_CHARTER.md`, `docs/MODULE_ARCHITECTURE_V1.md`, `docs/PLATFORM_FOUNDATION_V1.md`
- 기준 Issue: #91
- 기준 PR: #92
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
| 빠른 업무기록 | MAIN / 실사용 | 기존 업무기록 결과, 내부 Result 계약은 정식 명명 필요 | Task / Schedule / FollowUp 일부 연결 | Auth/Permission 현행, 향후 Workspace Context / Sync | Notion Worklog Adapter, Web Speech | **P0 · 기존 핵심 보호** |
| 일정 | PARTIAL / 독립 모듈 미완성 | `Schedule` | `ScheduleCandidate` | Workspace Context / Sync / Conflict / Audit | Google Calendar Adapter(향후) | **P0 · 신규 공통 연결의 중심** |
| 통화정리 | DRAFT / 개발 고도화 중 | `CallReport` | Task / Schedule / Contact / FollowUp | Storage / Processing Job / Retry·Idempotency / Usage·Cost / Retention | STT / AI / 향후 CRM·Calendar | **P0 · 일정 계약 이후 재정리** |
| 문서 스캔/PDF | DRAFT / 개발 중 | `ScanDocument` | 기본 없음, OCR/AI 확장 시 기존 Candidate 연결 | Local Storage / Storage Adapter(선택) / Export | 기기 카메라·갤러리 / OCR 선택 | **P0~P1 · 병렬 마무리 가능** |
| 브리핑 | MAIN / 실사용 | 읽기/View 결과 | Confirmed 업무/일정 조회 중심 | Workspace Context(향후) / Sync read / Audit 일부 | 현재 Notion / Kakao Delivery | **P1 · 기존 핵심 보호** |
| 회의정리 | PLANNED | `MeetingReport` | Task / Schedule / Contact / FollowUp | Storage / Processing Job / Usage·Cost / Retention | STT / AI | **P1** |
| 캡처 분석 | PLANNED | `CaptureAnalysis` | Task / Schedule / Contact / FollowUp | Local Storage / Processing Job(필요 시) / Usage·Cost | OCR / AI | **P1 · 일정 유입경로로 중요** |
| 메일 업무화 | PLANNED | `MailAnalysis` | Task / Schedule / Contact / FollowUp | Auth/Permission / Processing Job(필요 시) | Gmail/메일 Connector / AI | **P1~P2** |
| CRM | PLANNED | `Contact`/`Customer` 영역 Result 정식화 필요 | Contact / FollowUp | Workspace Context / Permission / Sync / Conflict / Audit | 외부 CRM은 향후 Adapter | **P1~P2** |
| 업무 문서 | PLANNED | `WorkDocument` 후보 | 기본 없음 | Workspace Context / Storage / Export | 문서/PDF Export / 향후 외부 문서 Adapter | **P2** |

우선순위는 모든 기능을 순차 개발한다는 뜻이 아니다. 제품가치와 공통 의존성을 기준으로 `중심 계약`, `병렬 가능`, `후속 확장`을 구분한다.

---

# 3. 빠른 업무기록

## 사용자 가치
말하거나 직접 입력한 업무를 최대한 빠르게 잃지 않고 기록한다.

## 현재 상태
**MAIN / 실사용.** 현재 제품의 가장 성숙한 핵심 흐름이다.

현재 main에는 음성/직접입력, 여러 업무 분리, 날짜·시간 구조화, Notion 저장, 실패 시 입력 보존 등이 존재한다. 현재 운영 업무기록의 실제 원장은 Notion `🎙 업무 통합 기록`이다.

## 독립 완료선
`말하기/직접입력 → 빠른 기록 → 즉시 수정 가능 → 실패 시 원문 보존`

## Platform Foundation 대조
- 오타·음성인식 오류가 있어도 의미가 전달되면 기록을 막지 않는다.
- 직접 명시한 일정/업무는 낮은 위험이면 빠르게 저장할 수 있다.
- Notion 종속 부분은 정상 작동을 깨지 않는 범위에서 점진적으로 Adapter 뒤로 이동한다.
- Workspace 도입 시 현재 개인 사용 흐름을 복잡하게 만들지 않는다.

정상 작동 중인 음성 기록을 Platform Foundation 도입만을 이유로 전면 재작성하지 않는다.

---

# 4. 일정

## 사용자 가치
**일정을 놓치지 않는 것이 제품의 최우선 가치다.**

장기 일정 유입 경로:
- 사용자가 직접 말함
- 직접 입력
- 통화에서 추출
- 회의에서 추출
- 메일에서 추출
- 카카오톡/문자 캡처에서 추출

## 현재 상태
**PARTIAL.** main에는 음성 입력의 날짜·시간 구조화와 브리핑의 일정성 정보 표시가 있다. 그러나 업무수첩 자체의 독립 일정 저장소·화면·계약은 아직 완성되지 않았다.

## 목표 핵심 흐름
`직접 일정 입력 또는 ScheduleCandidate → 확인/수정 → 업무수첩 Schedule 저장 → 브리핑/알림 → 선택적 Google Calendar 전송`

## 공통 계약
- `ScheduleCandidate`: AI/문맥 추출 제안
- `Schedule`: 사용자 명시 입력 또는 Confirmed 일정
- `SourceRef`: 통화/회의/메일/캡처 등 출처

## UX 기준
- 사용자가 `내일 3시 김대리 전화 일정 잡아줘`처럼 직접 명시하면 불필요한 재확인을 최소화한다.
- 통화/회의/메일/캡처에서 추론한 일정은 기본 Candidate다.
- 수정 기능은 결과 가까이에 둔다.
- 사소한 오타 때문에 일정 기록 자체를 막지 않는다.

## 1차 설계 범위
다른 모듈보다 먼저 일정 앱 전체를 완성하는 것이 목적이 아니다. 다음 **중심 뼈대**를 먼저 확정한다.

1. `Schedule` 최소 내부 계약
2. `ScheduleCandidate → Schedule` 확정 경계
3. `SourceRef`
4. 빠른 수정/삭제 UX
5. Workspace 소유권
6. revision/sync_state 최소 필드
7. 향후 Calendar Adapter가 붙을 외부 ID 경계

알림 고도화, 반복 일정 전체, 복잡한 양방향 Calendar Sync는 이후 단계다.

---

# 5. 통화정리

## 사용자 가치
휴대폰에 저장된 통화녹음을 선택해 중요한 통화만 정리하고, 녹취·보고서·업무·일정·후속조치 후보를 만든다.

## 현재 상태
**DRAFT / 고도화 중. main 미반영.**

주요 흐름:
- Issue #58 / PR #59: 통화녹음 선택·분류
- Issue #74 / PR #75: Android 직접 파일선택 UX
- Issue #78 / PR #79: 모의 분석 검수 UX V2
- Issue #80 / PR #81: `CallReport` V1 + STT 연결 직전 준비
- 관련 기반 PR #62/#64/#66/#68/#70/#72 등

PR #81 기준 실제 STT/AI 공급자 호출, 실제 업무수첩 Object Storage, 중앙 Usage DB, API Key, 유료 처리 승인은 의도적으로 미연결이다.

## 독립 완료선
`통화녹음 선택 → STT → 전체 녹취 → CallReport → 사용자 검수/수정 → 로컬 결과 보존/공유`

업무/일정/CRM 연결 실패가 `CallReport`를 파괴하면 안 된다.

## Result / Candidate
- Result: `CallReport`
- Candidate: `TaskCandidate`, `ScheduleCandidate`, `ContactCandidate`, `FollowUpCandidate`
- 출처: Call `SourceRef`

## 공통 플랫폼으로 승격 검토할 기존 기반
통화 stacked PR의 다음 기반은 통화 전용 표준으로 굳히지 않는다.
- Processing Job
- Retry / Idempotency
- Usage / Cost Ledger
- Retention/Delete
- STT/AI Adapter Contract
- Storage prepared-upload 경계

Platform Foundation 최소 기반과 일정 계약을 먼저 확정한 뒤, 공통 계약과 일치하는 부분만 integration checkpoint에서 재사용/이관한다.

## 현재 위험
깊은 stacked PR 구조가 있다. 개별 브랜치를 오래된 순서대로 모두 main에 병합하지 않고, 공통 플랫폼 기준으로 stack을 얕게 재정리한다.

---

# 6. 문서 스캔 / PDF

## 사용자 가치
카메라로 새로 촬영하거나 **이미 갤러리에 찍어둔 문서 사진을 빠르게 가져와 스캔**하고 여러 장 PDF로 저장/공유한다.

## 현재 상태
**DRAFT / main 미반영.**

- Issue #49 / PR #60: 1장 스캔 + Notion 첨부 V1
- Issue #82 / PR #83: 갤러리 우선 + 여러 장 + PDF 저장/공유
- PR #84: Preview QA 전용

## 독립 완료선
`갤러리 선택 또는 카메라 촬영 → 모서리/보정 → 페이지 관리 → PDF → 로컬 저장/공유`

OCR과 Notion은 필수 성공조건이 아니다.

## Result / Candidate
- Result: `ScanDocument`
- 기본 Candidate 없음
- 향후 OCR/AI 분석은 기존 Task/Schedule Candidate에 선택적으로 연결

## 개발 위치
스캔/PDF는 공통 플랫폼 의존성이 상대적으로 낮다. 따라서 **Platform 최소 뼈대와 일정 중심 계약을 진행하는 동안 병렬로 독립 도구 완성 검수를 진행할 수 있다.**

---

# 7. 브리핑

## 사용자 가치
오늘 놓치면 안 되는 업무, 지난 업무, 기다리는 일, 후속조치를 한 화면에서 확인한다.

## 현재 상태
**MAIN / 실사용.** 브리핑 2.0과 업무명 즉시 수정 등 후속 개선도 main에 반영돼 있다.

## 역할
브리핑은 새로운 업무 원장을 소유하는 모듈이 아니라 Confirmed 업무/일정/후속조치의 읽기 모델(View)에 가깝다.

현재는 Notion 데이터에 의존하지만 장기적으로 Worklog/Schedule 표준 계약을 읽도록 점진 이동한다. 현재 정상 기능을 전면 재작성하지 않는다.

---

# 8. 회의정리

## 현재 상태
**PLANNED.** 독립 구현 Issue/PR은 아직 없다.

## 목표 흐름
`회의 녹음 선택/녹음 → STT → MeetingReport → 수정/보존/공유 → Task/Schedule/Contact/FollowUp Candidate`

통화정리와 STT/Storage/Processing Job/Usage·Cost/Retention을 공유하되 `MeetingReport`와 `CallReport`의 도메인 내용은 분리한다.

---

# 9. 캡처 분석

## 현재 상태
**PLANNED.** 독립 구현 Issue/PR은 아직 없다.

## 사용자 가치
카카오톡/SMS 등의 화면 캡처에서 약속·날짜·할 일을 찾아 일정 누락을 줄인다.

## 목표 흐름
`갤러리/공유로 캡처 입력 → OCR/기기 처리 → CaptureAnalysis → Schedule/Task/Contact/FollowUp Candidate`

일정 중심 계약이 잡힌 뒤 비교적 높은 우선순위로 검토한다.

---

# 10. 메일 업무화

## 현재 상태
**PLANNED.** 독립 구현 Issue/PR은 아직 없다.

## 목표 흐름
`메일 Connector → 필요한 메일 선택/조회 → MailAnalysis → Task/Schedule/Contact/FollowUp Candidate`

원본 이메일의 원장은 Gmail/메일 공급자이며 업무수첩은 `SourceRef`로 참조한다.

초기에는 읽기/분석 중심, 최소 OAuth Scope로 시작하며 자동 메일 발송은 별도 고위험 Delivery 기능으로 취급한다.

---

# 11. CRM

## 현재 상태
**PLANNED.** 통화 Draft에는 연락처 후보가 있으나 독립 CRM 모듈은 아직 없다.

## 역할
- 고객/연락처는 Workspace 기준 데이터
- 담당 User는 별도
- 통화/회의/메일의 `ContactCandidate`를 기존 고객과 연결하거나 신규 후보로 제안
- FollowUp/일정/업무와 관계 연결

AI가 이름 유사성만으로 고객을 자동 병합하지 않는다. 고객 병합은 고위험 변경이다.

---

# 12. 업무 문서

## 현재 상태
**PLANNED.** 독립 문서작성/템플릿 모듈은 아직 없다.

## 사용자 가치
업무기록·고객·회의·통화의 확정 정보를 활용해 보고서, 확인서, 제안서 등 반복 문서를 빠르게 만든다.

## 목표 흐름
`문서 유형 선택 → 내부 데이터 선택 → 문서 초안 생성/편집 → 로컬 저장/공유/Export`

스캔/PDF가 기존 종이·이미지를 디지털 문서로 만드는 도구라면, 업무 문서는 구조화 데이터를 이용해 새 문서를 작성하는 도구다.

---

# 13. 공통 Platform Service와 소비 관계

| Platform Service | 1차 소비 모듈 | 비고 |
|---|---|---|
| Workspace Context | 전 모듈 | 개인 UX에서는 복잡성을 숨김 |
| Auth / Permission | 전 모듈 | Closed Beta 전에 실제 다중사용자 격리 필요 |
| Storage Service | 통화, 회의, 선택적 스캔/캡처/업무문서 | 원본 영구보관 기본 아님 |
| Processing Job | 통화, 회의, OCR/AI 처리 모듈 | 도메인 보고서 형식은 소유하지 않음 |
| Retry / Idempotency | 통화, 회의, 외부 연동 | 중복 비용·중복 일정 생성 방지 |
| Usage / Cost | STT/AI/OCR/Storage 사용 모듈 | workspace_id + user_id |
| Sync State / Conflict | 일정, CRM, 공유 결과, 다기기 결과 | V1은 revision 수준 |
| Retention / Delete | 통화/회의 녹취, 사용자 결과 | 24h 임시파일과 30일 휴지통 구분 |
| Audit / Event Log | 삭제, 권한, 외부전송, CRM 병합 등 | V1 최소 기록 |

---

# 14. Adapter / Processor Registry

| 경계 | 현재/목표 상태 | 소비 모듈 |
|---|---|---|
| Worklog / Notion Adapter | 현재 Notion 원장을 유지하되 도메인 직접종속 축소 | 업무기록, 브리핑, 선택적 각 모듈 |
| Calendar Adapter | 아직 독립 구현 전. 초기 단방향 우선 | 일정 및 Candidate 생성 모듈 |
| STT Adapter | 통화 Draft에 계약 존재, 실제 Provider 미연결 | 통화, 회의 |
| AI Adapter | 통화 Draft에 계약 존재, 실제 Provider 미연결 | 통화, 회의, 메일, 캡처, 업무문서 |
| Storage Adapter | 통화 Draft에 prepared-upload 계약 존재, 실제 업무수첩 Storage 미연결 | 통화, 회의, 선택적 OCR/문서 |
| Kakao Delivery | 기존 브리핑 전달 경로 실사용 | 브리핑 |
| Gmail/Mail Connector | 미구현 | 메일 업무화 |
| CRM Adapter | 내부 CRM 이후 필요 시 외부 CRM 연결 | CRM |

---

# 15. 확정된 현재 실행 순서

2026-09-13 종합기획에서 다음 순서를 1차 실행 기준으로 확정한다.

1. **Platform Foundation 최소 뼈대**
   - Workspace Context
   - Processing Job
   - Retry / Idempotency
   - Usage / Cost
   - Storage / Adapter 최소 경계
   - Auth/Sync/Retention/Audit은 최소 계약
2. **일정 모듈의 중심 계약을 우선 확정**
   - `Schedule`
   - `ScheduleCandidate`
   - `SourceRef`
   - Candidate → Confirmed 경계
   - 빠른 수정 UX
   - Workspace/Sync 최소 필드
3. **스캔/PDF는 병렬로 독립 도구 완성**
   - 갤러리 우선
   - 다중 페이지
   - 로컬 저장/공유
4. **통화 stack을 새 Platform + Schedule 계약 기준으로 재정리**
   - 깊은 stack을 그대로 순차 병합하지 않음
   - integration checkpoint에서 공통 기반과 통화 도메인을 분리
5. **실제 STT 연결 Gate 검수 후 Provider 연결 여부 결정**
6. **일정 유입 경로 확대**
   - 통화
   - 캡처
   - 회의
   - 메일
7. CRM/업무문서는 핵심 개인 업무 흐름 안정 후 확장

핵심 해석:

> **일정 앱 전체를 먼저 완성하는 것이 아니라, 모든 모듈이 같은 방식으로 일정을 만들어낼 수 있도록 일정의 중심 뼈대를 먼저 만든다.**

`MODULE_ARCHITECTURE_V1.md`에서 통화정리와 스캔/PDF를 첫 표준 모듈 사례로 정의한 원칙은 유지한다. 여기서 일정 우선은 그 두 모듈보다 일정 앱 전체를 먼저 완성한다는 뜻이 아니라, 통화·회의·캡처·메일이 공통으로 사용할 `Schedule`/`ScheduleCandidate` 계약을 선행 고정한다는 뜻이다.

빠른 업무기록과 브리핑의 main 실사용 안정성은 모든 단계에서 회귀 보호한다.

---

# 16. V1에서 하지 않는 것

- 모든 PLANNED 모듈을 동시에 개발하지 않는다.
- 기존 main 기능을 모듈화 명분으로 전면 재작성하지 않는다.
- 통화 stacked PR의 공통 기반을 검토 없이 전체 플랫폼 표준으로 확정하지 않는다.
- 완전한 실시간 다기기 공동편집을 만들지 않는다.
- 기업용 세분 권한/복잡한 Billing을 개인 V1보다 먼저 만들지 않는다.
- 특정 Notion/STT/AI/Cloud Provider를 도메인 모델의 기준으로 삼지 않는다.
- 일정 모듈 전체 완성을 기다리느라 독립적인 스캔/PDF 완성을 막지 않는다.

---

# 17. 내용 검수 결과

다음 항목을 대조했고 현재 **중대한 충돌 없음**으로 판정한다.

- Charter의 장기 제품 범위와 Registry 모듈 목록
- `MODULE_ARCHITECTURE_V1.md`의 Standalone-first / Result Model / Adapter / 점진적 이행 원칙
- Platform Foundation Decision 01~08의 저장·소유권·Candidate·Platform Service·개인정보·Adapter·상용화·Sync 기준
- 실제 main 기능과 DRAFT PR 상태의 구분
- 일정 중심 계약과 통화/회의/메일/캡처의 공통 연결 관계
- 통화 stack에 존재하는 공통 기반과 향후 Platform Service 승격 방향
- 빠른 업무기록/브리핑을 불필요하게 재작성하지 않는 원칙
- V1에서 과도한 범용화 시스템을 만들지 않는 원칙

내용 검수 시점 기준 PR #92는 main 대비 behind 0이며 변경 파일은 `docs/PLATFORM_FOUNDATION_V1.md`, `docs/MODULE_REGISTRY.md` 두 개뿐이다. 최종 exact-commit Deploy Preview 성공을 확인한 뒤 사용자 main 반영 승인을 받는다.
