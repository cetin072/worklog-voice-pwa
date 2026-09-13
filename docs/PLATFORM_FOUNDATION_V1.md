# 업무수첩 Platform Foundation V1

## 문서 상태

- 상태: Decision 01~08 확정 / 전체 검토 완료
- 기준 Issue: #91
- 기준 PR: #92
- 목적: 독립적으로 개발되는 업무수첩 모듈들이 하나의 상용 제품으로 결합될 때 따라야 할 공통 플랫폼 기준을 정의한다.
- 기록 원칙: 종합 기획에서 하나의 주제가 확정될 때마다 즉시 GitHub에 반영하며, 채팅 기록을 장기 기준으로 사용하지 않는다.

이 문서는 `PROJECT_CHARTER.md`와 `docs/MODULE_ARCHITECTURE_V1.md` 아래에서 Auth, Workspace, 데이터 소유권, 동기화, 공통 Result/Candidate, Platform Service 등의 공통 규칙을 구체화한다.

---

# Decision 01 — 데이터 원본과 저장소 역할

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

> **사용자 콘텐츠는 Local-first, 시스템 운영 데이터는 Cloud-first. 클라우드는 사용자 콘텐츠의 강제 원본 창고가 아니라 필요에 따라 동기화·복구·다기기·검색·협업을 제공하는 계층으로 사용한다.**

- Device Original: 통화/회의 원본 음성, 사진, 캡처 등 사용자가 직접 보유한 원본. 기본 위치는 사용자 기기.
- Local Canonical Copy: 녹취록, AI 요약, 통화/회의 보고서, PDF 등 사용자 소유 결과물. 가능한 한 기기에서 먼저 저장·사용.
- Cloud Synced Copy: 복구, 다기기, 검색, 관계 연결, 협업을 위한 선택적 동기화본.
- System Record: Auth, Workspace/Membership, Permission, Processing Job, Retry/Idempotency, Usage/Cost, Sync 상태 등 서버 기준 운영정보.

원본 음성·사진 전체 자동 클라우드 백업을 기본값으로 하지 않는다. PWA의 IndexedDB/LocalStorage는 Local-first 저장과 실패 복구에 사용할 수 있지만 유일한 영구 원본이라고 보장하지 않는다.

STT/OCR/AI 처리를 위한 대용량 업로드는 private 임시 Object Storage를 사용한다. 결과 저장 성공 후 즉시 삭제하고 실패 재처리 유예를 두더라도 기본 절대 보관 상한은 24시간으로 한다. 만료 파일 청소 작업을 별도로 둔다.

Supabase는 클라우드 드라이브가 아니라 업무수첩의 앱 백엔드 기반으로 본다. Auth, Workspace, Permission/RLS, Processing Job, Retry/Idempotency, Usage/Cost, Sync 상태, 시스템 메타데이터 등을 중심으로 맡는다. 모든 사용자 콘텐츠를 반드시 Supabase에 영구 저장하지 않는다.

현재 기존 업무기록은 Notion `🎙 업무 통합 기록`을 실제 원장으로 유지한다. 장기적으로 Notion은 선택적 Adapter/동기화 대상으로 전환할 수 있으나 별도 명시적 결정과 Migration 검증이 필요하다.

Google Calendar 등 외부 업무도구는 Adapter이며, STT/AI/OCR 공급자는 Processor이고 데이터 원장이 아니다. 녹취록과 AI 결과물은 원본 음성과 별도의 보관정책을 가질 수 있어야 한다.

---

# Decision 02 — 사용자 / Workspace / 데이터 소유권 모델

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

> **User는 사람이고 Workspace는 업무공간이다. 업무 데이터의 기본 소유 단위는 Workspace이며, 생성자·담당자 User와 원본 기기 소유권은 별도로 관리한다.**

- 한 User는 여러 Workspace에 참여할 수 있다.
- 하나의 Workspace에는 여러 User가 참여할 수 있다.
- 모든 사용자는 Personal Workspace 1개를 기본으로 가진다.
- 사용자 UX에서는 Personal Workspace를 `내 업무`처럼 단순하게 표현할 수 있다.
- 초기에는 Personal Workspace 여러 개 생성을 기본 기능으로 제공하지 않는다.
- 추가 Workspace는 조직·팀·프로젝트 등 명확한 공동 업무공간으로 확장한다.

업무, 일정, CRM, 통화, 회의, 문서, Usage/Cost 등 핵심 업무 데이터는 원칙적으로 `workspace_id`를 가진다. 데이터 소속과 생성자/담당자 관계를 분리해 `workspace_id`, `created_by_user_id`, `assigned_user_id` 등을 필요한 도메인에 사용한다.

Personal Workspace 데이터는 개인 업무공간 소유, 조직/프로젝트 Workspace 데이터는 해당 Workspace 소유로 본다. 조직 멤버가 떠나도 조직 데이터는 남으며 User 탈퇴/멤버 제거와 Workspace 삭제는 별개다.

조직 Workspace에서 처리했더라도 휴대폰에 있는 원본 음성·사진은 Device Original로서 사용자 기기 원본이다. 조직 업무를 위해 확정·공유한 통화보고서, 업무, 일정, CRM 연결은 Workspace 데이터가 될 수 있다.

V1 최소 역할은 `owner`, `member`다. `admin`, `viewer` 등은 실제 필요 시 확장한다.

Usage/Cost는 `workspace_id`와 `user_id`를 함께 기록해 전체/Workspace/사용자/기능/Provider별 비용을 집계할 수 있게 한다.

---

# Decision 03 — 모듈 공통 결과 계약과 Candidate → Confirmed 흐름

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

> **업무수첩은 기록을 완벽하게 만들기 위해 기록 자체를 늦추지 않는다. 사용자의 명시적 입력은 편의성 우선으로 빠르게 기록하고 쉽게 수정하게 하며, AI가 문맥에서 추론한 결과는 Candidate로 제안하고 중요한 외부 실행은 신중하게 확정한다.**

## 모듈 Result와 공통 Candidate

각 모듈은 자기 고유 Result를 가진다.

예:
- `CallReport`
- `MeetingReport`
- `ScanDocument`
- `MailAnalysis`
- `CaptureAnalysis`

서로 다른 모듈에서 공통 업무 행동을 발견하면 제각각 다른 형식이 아니라 공통 Candidate 계약으로 변환한다.

V1 우선 Candidate:
- `TaskCandidate`
- `ScheduleCandidate`
- `ContactCandidate`
- `FollowUpCandidate`

모든 Candidate는 `SourceRef`를 통해 통화/회의/메일/캡처/직접입력 등 원래 출처를 추적할 수 있어야 한다.

## 기록은 관대하게, 실행은 신중하게

업무수첩은 100% 맞춤법이나 AI 정확도보다 빠르게 놓치지 않고 기록하는 편의성을 우선한다. 사소한 오타, 띄어쓰기, 음성인식 오류 때문에 기록을 막지 않는다.

사용자가 직접 말하거나 입력한 내용은 의미가 충분히 전달되면 먼저 기록할 수 있고, 결과 바로 옆의 눈에 잘 보이는 `[수정]` 같은 UX로 즉시 고칠 수 있게 한다. 수정 기능을 깊은 메뉴에 숨기지 않는다.

사용자가 `내일 오후 3시 김대리 전화 일정 잡아줘`처럼 명확하게 지시한 낮은 위험의 내부 기록은 불필요한 재확인 없이 바로 저장할 수 있다.

반대로 통화·회의·메일·캡처에서 AI가 문맥을 해석해 발견한 업무·일정·연락처·후속조치는 기본적으로 Candidate로 제안한다.

## Candidate와 Confirmed Record

- `TaskCandidate → Task`
- `ScheduleCandidate → Schedule`
- `ContactCandidate → Contact/CRM relation`
- `FollowUpCandidate → FollowUp`

Candidate는 제안이고 Confirmed Record는 실제 업무 데이터다. 사용자가 수정·확정한 값은 이후 AI 재분석 결과보다 우선하며 AI가 확정값을 자동으로 덮어쓰지 않는다.

외부 메시지/메일 전송, 중요한 외부 Calendar 변경, CRM 병합, 데이터 삭제, 결제/유료 처리, 조직 공유 데이터의 중대한 변경 등 위험도가 높은 행동은 별도 확인 또는 명시적 자동화 설정을 우선한다.

사용자가 특정 입력·규칙·자동화에 명시적으로 동의한 경우에만 제한적으로 Auto-confirm을 허용할 수 있다.

---

# Decision 04 — 공통 Platform Services의 범위

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

> **플랫폼은 여러 모듈이 공유해야 하는 공통 기반만 소유하고, 통화·회의·스캔·CRM 등 각 도메인의 고유 기능과 UI는 소유하지 않는다. 둘 이상의 모듈에서 반복되거나 Auth·보안·비용처럼 명백한 전역 관심사일 때만 Platform Service로 승격한다.**

## V1 우선 실제 구현 대상

- `Workspace Context`: 현재 User/Workspace/Role을 공통으로 제공한다. 각 모듈이 별도 Workspace 선택·권한 체계를 만들지 않는다.
- `Storage Service`: 임시 업로드, 파일 참조, 삭제, 만료 등 최소 Storage 경계를 제공하고 공급자 세부사항은 Adapter 뒤에 숨긴다.
- `Processing Job`: `queued`, `processing`, `completed`, `failed`, `cancelled` 등 공통 처리상태와 Job 식별자를 제공한다.
- `Retry / Idempotency`: 사용자 중복 클릭·네트워크 재시도 때문에 STT/AI/OCR 호출과 비용이 중복되지 않도록 공통 중복방지/재시도 기준을 둔다.
- `Usage / Cost`: `workspace_id`, `user_id`, feature, provider, model, usage, estimated/actual cost를 공통 방식으로 기록할 수 있게 한다.
- `Adapter Boundary`: STT, AI, Storage, Worklog/Notion, Calendar, CRM 등 외부 공급자를 모듈에서 직접 결합하지 않도록 공통 경계를 둔다.

## V1에서 계약은 두되 최소 구현하는 대상

- `Auth / Permission`: 모듈에는 현재 사용자·Workspace·역할과 필요한 권한 결과만 전달하고, 특정 Auth 공급자에 직접 결합하지 않는다.
- `Sync State`: Local-first를 지원하기 위한 최소 상태(`local`, `pending`, `synced`, `failed` 등)를 정의하되 완전한 양방향 동기화 엔진은 만들지 않는다.
- `Retention / Delete`: `retentionPolicy`, `expiresAt`, 삭제요청/완료 상태 등 확장 가능한 최소 개념을 둔다.
- `Audit / Event Log`: 삭제, 권한 변경, 외부 전송, 유료 처리 등 중요한 사건을 추적할 수 있는 최소 경계를 둔다. 모든 클릭을 기록하는 거대한 감사 시스템은 만들지 않는다.

## Platform Service 승격 원칙 — 2-Module Rule

특정 모듈 하나에서만 필요한 기능은 우선 그 모듈에 둔다.

다음 중 하나일 때 공통 Platform Service 승격을 검토한다.

1. 둘 이상의 모듈에서 같은 문제가 반복된다.
2. Auth, Permission, Security, Cost, Workspace처럼 본질적으로 전역 관심사다.
3. 제각각 구현할 경우 비용 중복, 보안 위험, 데이터 계약 충돌이 발생한다.

공통화를 위해 정상 작동 중인 모듈을 선제적으로 대규모 리팩터링하지 않는다. 실제 기능 확장·버그수정·Provider 교체 등 자연스러운 변경 시점에 점진적으로 공통 경계에 연결한다.

## 플랫폼이 소유하지 않는 것

다음은 각 도메인 모듈이 소유한다.

- CallReport 생성 규칙과 통화 UX
- MeetingReport/회의록 형식과 회의 UX
- ScanDocument/PDF 보정·페이지 관리 UX
- CRM 고유 화면과 업무규칙
- 일정 고유 화면과 업무규칙
- 특정 모듈 전용 AI Prompt/분석 방식

App Shell과 Platform Service가 이 로직을 흡수해 거대한 단일 모듈이 되지 않게 한다.

## V1에서 의도적으로 만들지 않는 것

- 완전한 양방향 Multi-device Sync Engine
- 복잡한 조직 Role/Permission 체계
- 모든 사용자 행동을 저장하는 정교한 Audit 시스템
- 자동 Billing/결제 시스템 전체
- 모든 Provider를 런타임에 꽂는 범용 Plugin Framework

상용화에 필요해지는 시점에 별도 결정과 검증을 거쳐 확장한다.

---

# Decision 05 — 개인정보·보관기간·삭제 원칙

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 법률·보안·사업상 요구가 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

> **업무에 필요한 사용자 결과물은 보존하되, 처리 때문에 잠깐 필요한 개인정보와 원본 파일을 이유 없이 서버에 장기 축적하지 않는다. Local-first를 유지하면서 사용자가 동기화·보관·삭제 범위를 통제할 수 있게 한다.**

## 데이터별 기본 보관 원칙

- 원본 통화/회의 음성: 사용자 기기 기본 보관, 서버 영구보관을 기본값으로 하지 않는다.
- 원본 사진/캡처: 사용자 기기 기본 보관.
- STT/OCR/AI 처리용 임시 사본: 성공 후 즉시 삭제, 실패 재처리 유예가 있어도 기본 최대 24시간.
- 녹취록, AI 요약, 통화/회의 보고서, PDF: Local-first. Cloud Sync/Backup은 사용자 선택 또는 Workspace 정책에 따라 적용.
- Auth, Workspace/Membership, Usage/Cost, Processing Job, 필요한 Audit/System Record: 서버 기준 보관.

## 최소수집 원칙

기능 수행에 필요한 최소 데이터만 서버 또는 외부 Processor로 전달한다. `나중에 쓸 수도 있다`는 이유만으로 연락처 전체, 원본 파일 전체, 불필요한 부가정보를 수집·전송하지 않는다.

## 삭제 범위를 구분한다

Local-first 구조에서는 내부적으로 최소한 다음 삭제 의미를 구분할 수 있어야 한다.

- Local Copy 삭제
- Cloud Copy 삭제
- Everywhere 삭제

사용자 UX에서는 기술용어를 그대로 노출하지 않고 `이 기기에서 삭제`, `모든 기기와 클라우드에서 삭제`처럼 이해하기 쉬운 표현으로 단순화할 수 있다.

Cloud Sync를 끄는 것과 기존 Cloud Copy를 삭제하는 것은 별개의 행위다. Sync OFF 시 기존 Cloud Copy를 유지할지 삭제할지 사용자가 선택할 수 있는 구조를 허용한다.

## 휴지통과 영구삭제

일반 사용자 콘텐츠 삭제는 실수 복구를 위해 기본적으로 휴지통을 거칠 수 있게 한다.

- 휴지통 기본 보관기간: **30일**
- 기간 종료 후 영구삭제 대상이 된다.
- 사용자는 필요할 경우 `즉시 영구삭제`를 명시적으로 선택할 수 있어야 한다.
- 처리용 임시 음성/이미지의 최대 24시간 정책은 휴지통 정책과 별개다.

## 녹취록과 AI 결과물의 Retention

녹취록은 업무상 장기 보관 필요와 개인정보 민감성이 동시에 있으므로 일률적으로 짧게 강제삭제하지 않는다. 플랫폼은 향후 다음과 같은 정책을 지원할 수 있어야 한다.

- 계속 보관
- 일정 기간 후 삭제
- 보고서 생성 후 전체 녹취 삭제
- Cloud Sync 안 함

개인 Workspace에서는 사용자 선택을 우선하고, 조직 Workspace에서는 명시된 조직 정책이 적용될 수 있다. 조직이 원본 음성의 Cloud 장기보관을 요구하는 경우에는 별도 고지·권한·법적 검토가 필요하다.

## 외부 Processor도 개인정보 경계에 포함한다

STT/AI/OCR Provider 선정 시 다음을 확인하고 기록한다.

- 입력 데이터 보관기간
- 모델 학습 사용 여부
- 보관/학습 비활성화 가능 여부
- 삭제 가능 여부
- 처리 지역
- 개인정보 처리조건

가능하면 학습 미사용·최소 보관 설정을 우선한다. Provider 교체 시 해당 개인정보 조건도 다시 검수한다.

## 계정·Membership·Workspace 삭제를 분리한다

- User 탈퇴
- Workspace Membership 제거
- Personal Workspace 삭제
- Organization/Project Workspace 삭제

위 작업은 서로 다른 행위다. 조직 멤버 한 명이 탈퇴하거나 제거돼도 조직 Workspace 업무 데이터는 자동 삭제되지 않는다.

Workspace 전체 삭제는 다수 사용자의 고객·업무·통화·회의·문서를 제거할 수 있는 고위험 작업이므로 강한 확인과 권한 검증을 거친다.

## Export 원칙

상용화 전 사용자가 자신의 데이터를 서비스 밖으로 가져갈 수 있는 Export 경로를 제공한다.

정확한 형식은 별도 설계에서 정하되 업무, 일정, CRM, 통화/회의 결과, 문서 메타데이터 등 사용자 소유 데이터가 서비스에 완전히 잠기는 구조를 만들지 않는다.

## 한 줄 기준

> **필요한 업무 결과는 보존하고, 처리용 개인정보는 최소한만 보관하며, 사용자가 Local/Cloud/Everywhere 삭제와 Cloud Sync 범위를 통제할 수 있게 한다. 일반 삭제는 기본 30일 복구 기회를 제공하되 명시적 영구삭제 경로도 둔다.**

---

# Decision 06 — 외부 서비스 연동 원칙과 Adapter 경계

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

> **업무수첩 자체 데이터와 기능이 먼저이고 외부 서비스는 Processor, Connector, Delivery, Infrastructure Provider로 연결한다. 특정 외부 서비스 하나가 없어도 가능한 범위에서는 핵심 기능이 계속 작동해야 한다.**

## 외부 서비스 역할 구분

- `Processor`: STT, AI, OCR 등 입력을 처리해 결과를 반환한다.
- `Connector`: Notion, Google Calendar, Gmail 등 외부 데이터를 읽거나 쓴다.
- `Delivery`: Kakao, 이메일 발송 등 업무수첩 결과를 전달한다.
- `Infrastructure Provider`: Supabase Storage, S3/R2 등 저장·서버 기반을 제공한다.

각 모듈은 외부 Provider의 API를 직접 호출하거나 Provider 고유 응답을 그대로 UI 상태로 사용하지 않는다. 내부 표준 요청/결과와 Adapter 경계를 거친다.

## 내부 ID와 외부 ID를 분리한다

업무수첩 내부 `task_id`, `schedule_id`, `customer_id` 등이 기준이며 Notion `page_id`, Google `event_id`, Gmail `message_id` 등은 외부 연결정보로 관리한다.

외부 서비스 ID를 업무수첩 내부 데이터의 기본 식별자로 사용하지 않는다.

## 초기 연동은 가능한 한 단방향을 우선한다

초기에는 연동별 방향을 명확히 정한다.

예:
- 업무수첩 Schedule → Google Calendar
- Notion → 업무수첩 또는 업무수첩 → Notion 중 해당 기능에 맞는 명확한 한 방향
- Gmail message → 업무수첩 Candidate

완전한 양방향 동기화는 충돌·삭제·반복일정·timezone·version 정책이 필요한 별도 기능으로 보고 실제 수요가 확인된 후 설계한다.

## Core Result와 Integration Result를 분리한다

외부 서비스 실패 때문에 이미 만든 핵심 결과를 실패로 취급하거나 삭제하지 않는다.

예:
- `CallReport 생성 성공 / Notion 연동 실패`
- `PDF 생성 성공 / Cloud Drive 업로드 실패`
- `Schedule 저장 성공 / Google Calendar Sync 실패`

연동 실패는 별도 상태로 표시하고 재시도할 수 있어야 한다.

## Retry, Idempotency, Sync 상태

외부 연동은 중복 생성·중복 과금·중복 전송을 막기 위해 내부 ID, 외부 ID, Sync 상태, Idempotency Key를 사용할 수 있어야 한다.

사용자 중복 클릭이나 네트워크 재시도로 Google 일정, Notion 페이지, 외부 메시지가 중복 생성되지 않게 한다.

## 권한과 연결 해제

OAuth 및 외부 서비스 권한은 기능 수행에 필요한 최소 Scope만 요청한다.

사용자는 외부 연결을 해제할 수 있어야 하며 다음 세 작업을 서로 다르게 취급한다.

- 외부 서비스 연결 해제
- 업무수첩 내부 데이터 삭제
- 외부 서비스에 이미 생성된 데이터 삭제

연결 해제만으로 내부 업무 데이터나 외부 데이터를 임의로 삭제하지 않는다.

## 유료 Processor와 Cost Gate

STT/AI/OCR 등 사용량 기반 비용이 발생하는 Processor는 공통 Usage/Cost 체계를 거친다.

필요한 경우 Workspace 정책, 사용량 한도, 예상비용 확인 등 Cost Gate를 적용할 수 있게 한다.

Provider 비용과 사용량은 특정 모듈 내부에만 기록하지 않고 공통 Usage/Cost Ledger에서 추적한다.

## Provider 교체 가능성

내부 표준 요청/결과 계약을 먼저 정의하고 실제 Provider 응답은 Adapter에서 정규화한다.

Provider 교체가 모듈 UI와 도메인 로직의 대규모 재작성으로 이어지지 않아야 한다.

장기적으로 기능·언어·비용에 따라 Provider를 달리 선택할 수 있으나 V1에서 범용 자동 Provider Routing 시스템까지 만들지는 않는다.

## 외부 원본 SourceRef

Gmail 등 외부 서비스가 실제 원본인 경우 업무수첩이 원본 소유권을 억지로 가져오지 않는다.

예:
`Gmail message → Mail Analysis → TaskCandidate / ScheduleCandidate`

이 경우 Candidate/Result의 `SourceRef`에 원본 서비스 종류와 외부 참조를 기록해 출처를 추적할 수 있게 한다.

## 한 줄 기준

> **내부 모델이 먼저이고 외부 서비스는 교체 가능한 연결 계층이다. 외부 연동 실패는 핵심 결과를 파괴하지 않으며, 최소 권한·단방향 우선·Retry/Idempotency·Cost 추적을 기본으로 한다.**

---

# Decision 07 — 상용화 전환 기준과 단계별 출시 구조

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 시장·비용·법률 환경이 크게 바뀌지 않는 한 단계 전환의 기본 Gate로 사용한다.

> **출시는 날짜나 기능 개수로 결정하지 않고 단계별 품질·보안·운영 Gate 충족 여부로 결정한다. 모든 모듈 완성을 기다리지 않고 반복 사용 가치가 검증된 핵심 모듈과 안정적인 플랫폼이 준비되면 다음 단계로 올라간다.**

## 단계 구조

`2인 실사용 → Internal Alpha → Closed Beta → Public Beta → Paid Launch → Team/Business`

### 현재: 2인 실사용

실제 업무에서 반복 사용 가치를 검증한다. 기능을 많이 만드는 것보다 `계속 쓰는 기능`을 찾는 것이 우선이다. UX와 데이터 구조는 아직 비교적 빠르게 수정할 수 있다.

### Internal Alpha

한 제품으로서의 최소 골격을 갖춘다.

진입 기준:
- App Shell
- Workspace Context
- 공통 Platform Foundation 최소 구현
- 최소 2~3개의 실제로 완성도 있게 쓸 수 있는 독립 모듈
- 모듈 간 연결이 공통 계약을 따름

모든 모듈 완성을 요구하지 않는다.

### Closed Beta

개발자가 아닌 제한된 외부 사용자가 스스로 가입하고 사용할 수 있어야 한다.

진입 전 필수:
- 회원가입/Auth
- Personal Workspace 자동 생성
- 사용자/Workspace 데이터 격리와 권한 검증
- RLS 또는 동등한 서버 권한 보호
- Secret의 Client 노출 방지
- 기본 데이터 삭제
- 최소 Export 경로
- Usage/Cost 기록
- 오류 로그/실패 복구
- 개인정보 기본 정책
- 개발자 설명 없이 사용할 수 있는 기본 Onboarding

### Public Beta

불특정 사용자를 받기 전에 운영 통제 능력을 갖춘다.

필수:
- Usage/Cost 기반 Quota 또는 Limit
- 비용 폭주 방지
- 장애/오류 감지
- 계정 삭제 절차
- 개인정보 처리 안내와 서비스 이용약관
- 문의/지원 경로
- 기본 운영 대응체계

무료 한도는 기능 이름만으로 자르기보다 실제 원가를 기준으로 설계한다. 로컬 PDF 생성·메모처럼 원가가 거의 없는 기능과 STT/AI/OCR/Cloud Storage처럼 사용량 원가가 발생하는 기능을 구분한다.

### Paid Launch

돈을 받기 전에 사용자당 단위원가와 안정성을 검증한다.

필수 Gate:
- 사용자당 월 평균 STT/AI/Storage/DB/Bandwidth 원가 파악
- Free/Paid 사용량 정책
- 가격 및 Quota가 변동비를 감당하는지 검증
- Auth/Workspace/RLS/Secret 관리 검수
- 삭제/Export/Backup/Recovery 경로
- 오류감지/Usage/Cost/Provider 장애 대응
- Onboarding과 핵심 모바일 UX 안정성
- 약관/개인정보/결제 관련 운영 준비

구독 가격은 감으로 먼저 정하지 않고 실제 Usage/Cost 데이터를 근거로 결정한다.

### Team / Business

개인용 제품이 안정된 뒤 조직용 기능을 확장한다.

후보:
- 조직 Workspace
- Admin 역할
- 세분화된 권한
- 공유 CRM/업무/일정
- 조직 Retention 정책
- 조직 Usage/Cost/Billing
- 감사/관리 기능 강화

V1 개인 제품을 완성하기 전에 기업용 복잡성을 먼저 끌어오지 않는다.

## PWA와 Native의 관계

Native 앱 완성을 상용화 Gate로 두지 않는다.

PWA에서 로그인, 업무기록, 파일 선택, 스캔/PDF, 일정, 보고서, 기본 결제/계정관리 등 충분한 사용자 가치를 제공할 수 있다면 Beta와 상용화를 진행할 수 있다.

Android Native/Shell/Bridge는 통화녹음 접근, 파일시스템, 카메라, 공유, Background 작업, 알림 등 명확한 기기 이점이 있을 때 단계적으로 추가한다.

## 출시 후에도 개발 기준 유지

사용자가 늘어도 `Issue → Branch → Test → Preview → Review → Merge` 원칙을 유지한다. 오히려 Public Beta/Paid 단계로 갈수록 검증 기준을 강화한다.

## 한 줄 기준

> **강한 핵심 기능 몇 개와 안정적인 플랫폼이 있으면 Beta를 시작할 수 있다. 외부 사용자 전에는 보안·데이터 격리·삭제·Export를, 공개 Beta 전에는 Quota·비용통제·운영체계를, 유료화 전에는 실제 단위원가와 Backup/Recovery까지 검증한다. Native 완성은 상용화 필수조건이 아니다.**

---

# Decision 08 — Local-first 동기화와 충돌 기준

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 실제 다기기/협업 사용에서 더 나은 충돌 모델이 검증되기 전까지 기본 동기화 원칙으로 유지한다.

> **Local-first는 항상 휴대폰 값이 이긴다는 뜻이 아니다. 원본 미디어는 기기 기준, 시스템 운영 데이터는 서버 기준, 공유 Workspace의 확정 데이터는 Cloud 조정 기준으로 하며, 동기화된 사용자 데이터의 충돌은 사용자 확정값을 조용히 덮어쓰지 않는다.**

## 데이터 종류별 조정 기준

- Device Original(원본 음성·사진·캡처): 사용자 기기가 원본 기준이다.
- 개인 사용자 결과물(녹취록·AI 보고서·PDF 등): Local-first 작업본을 우선 보존하고, Cloud는 Sync/Backup 계층으로 사용한다.
- 조직/공유 Workspace에 확정·공유된 업무·일정·CRM·공유 보고서: 여러 사용자의 일관성이 필요하므로 Cloud가 조정 기준 역할을 한다.
- Auth, Workspace/Membership, Usage/Cost, Processing Job 등 System Record: 서버가 기준이다.

Cloud가 조정 기준인 데이터도 사용자의 로컬 수정본을 확인 없이 파괴하지 않는다.

## 최소 동기화 메타데이터

동기화 가능한 중요 레코드는 필요에 따라 다음 개념을 가질 수 있어야 한다.

- 안정적인 내부 `record_id`
- `revision` 또는 동등한 version
- `updated_at`
- `sync_state`

V1 최소 Sync State는 다음 수준을 우선한다.

- `local`
- `pending`
- `synced`
- `conflict`
- `failed`

실시간 공동편집이나 문장 단위 자동 Merge는 V1 범위로 만들지 않는다.

## 충돌 처리

한쪽만 변경되었다면 안전한 범위에서 자동 동기화할 수 있다.

동일한 기준 revision 이후 로컬과 Cloud가 모두 수정됐다면 충돌로 본다. 다음과 같은 사용자 확정 데이터는 단순 `last write wins`로 조용히 덮어쓰지 않는다.

- 사용자가 직접 수정한 업무
- 확정 일정
- CRM의 중요 정보
- 통화/회의 보고서의 사용자 수정 내용
- 사용자가 Confirm한 Candidate 결과

충돌 시 가능한 범위에서 양쪽 값을 보존하고 사용자가 확인·선택·수정할 수 있는 경로를 둔다.

Decision 03의 `사용자 확정값은 이후 AI 재분석보다 우선한다`는 원칙도 동일하게 적용한다.

## 삭제 동기화

동기화 대상의 삭제 사실이 다른 기기에서 이전 데이터로 되살아나지 않도록 `deleted_at`, tombstone 또는 동등한 삭제 표시를 사용할 수 있어야 한다.

기본 흐름은 다음과 같다.

`한 기기에서 삭제 → 삭제 상태 Sync → 다른 기기에 반영 → 휴지통 30일 → 영구삭제`

즉시 영구삭제를 사용자가 명시적으로 요청한 경우에는 Decision 05의 Everywhere 삭제 정책과 연결한다.

## 한 줄 기준

> **원본 미디어는 기기 기준, 시스템 데이터는 서버 기준, 공유 Workspace 데이터는 Cloud 조정 기준으로 한다. 사용자 수정·확정 데이터가 서로 충돌하면 revision으로 감지하고 양쪽을 보존해 확인시키며, 삭제도 동기화 상태로 전파한다.**

---

# Platform Foundation V1 검토 결과

Decision 01~08을 `PROJECT_CHARTER.md`와 `docs/MODULE_ARCHITECTURE_V1.md`에 대조한 결과 현재 큰 방향 충돌은 없다. 기존 상위 문서의 `독립 모듈`, `외부 서비스 Adapter`, `점진적 이행`, `PWA 우선`, `원본 기기 보존`, `비용 통제` 원칙을 Platform Foundation이 더 구체화하는 관계로 본다.

V1에서 더 많은 추상화·범용 시스템을 선제적으로 추가하지 않는다. 다음 단계는 실제 기능 목록과 현재 개발상태를 공통 기준에 대조하는 `docs/MODULE_REGISTRY.md` 작성이다.
