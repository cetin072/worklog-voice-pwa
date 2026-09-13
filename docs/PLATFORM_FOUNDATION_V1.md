# 업무수첩 Platform Foundation V1

## 문서 상태

- 상태: 작성 중
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

## 핵심 원칙

> **사용자 콘텐츠는 Local-first, 시스템 운영 데이터는 Cloud-first. 클라우드는 사용자 콘텐츠의 강제 원본 창고가 아니라 필요에 따라 동기화·복구·다기기·검색·협업을 제공하는 계층으로 사용한다.**

### 데이터 계층

- **Device Original**: 통화/회의 원본 음성, 사진, 캡처 등 사용자가 직접 생성·보유한 원본. 기본 위치는 사용자 기기다.
- **Local Canonical Copy**: 녹취록, AI 요약, 통화/회의 보고서, PDF 등 사용자가 소유하는 결과물. 가능한 한 기기에서 먼저 저장·사용할 수 있게 한다.
- **Cloud Synced Copy**: 복구, 다기기, 검색, 관계 연결, 협업을 위한 선택적 동기화본.
- **System Record**: Auth, Workspace/Membership, Permission, Processing Job, Retry/Idempotency, Usage/Cost, Sync 상태 등 서버 기준 운영정보.

### 사용자 기기

원본 음성·사진·캡처와 사용자 결과물은 기기 중심으로 다룬다. 업무수첩이 원본 음성·사진 전체를 사용자 동의 없이 자동 클라우드 백업하는 것을 기본값으로 하지 않는다.

현재 PWA의 IndexedDB/LocalStorage는 Local-first 저장, 실패 복구, 오프라인 Queue 등에 사용할 수 있지만 브라우저 데이터 삭제·기기 분실 위험 때문에 `절대 삭제되지 않는 유일한 영구 원본`이라고 보장하지 않는다.

### 처리용 Object Storage

STT/OCR/AI 처리를 위한 대용량 업로드는 private 임시 Object Storage를 사용한다.

기본 정책:
1. 사용자가 처리 파일을 명시적으로 선택한다.
2. private 임시 Storage에 업로드한다.
3. 처리를 수행한다.
4. 결과 저장 성공을 확인한다.
5. 정상 성공 시 처리용 원본을 즉시 삭제한다.
6. 실패 시 짧은 재처리 유예를 둘 수 있다.
7. 기본 절대 보관 상한은 24시간이다.
8. 정상 삭제 외에 만료 파일 청소 작업을 둔다.

Storage 공급자는 Supabase Storage, S3/R2 계열 등으로 교체 가능하도록 Adapter 뒤에 둔다.

### Supabase

Supabase는 `클라우드 드라이브`가 아니라 **업무수첩의 앱 백엔드 기반**으로 본다.

주요 책임 후보:
- Auth / 사용자 식별
- Workspace / Membership
- Permission / RLS
- 관계형 시스템 데이터
- Processing Job
- Retry / Idempotency
- Usage / Cost
- Sync 상태
- 시스템 메타데이터
- 필요한 사용자 콘텐츠의 Cloud Sync/Backup

모든 사용자 콘텐츠를 반드시 Supabase에 영구 저장하지 않는다. Supabase 고유 스키마가 도메인 모듈을 지배하지 않게 하며, 향후 Google Cloud/AWS/다른 PostgreSQL 등으로 교체해도 모듈 대규모 재작성이 없도록 경계를 둔다.

### Notion과 외부 서비스

현재 기존 업무기록은 Notion `🎙 업무 통합 기록`을 실제 원장으로 유지한다. 이를 Supabase로 즉시 이전하지 않는다. 장기적으로 Notion은 선택적 Adapter/동기화 대상으로 전환할 수 있으나 별도 명시적 제품 결정과 Migration 검증이 필요하다.

Google Calendar 등 외부 업무도구는 Adapter다. STT/AI/OCR 공급자는 Processor이며 데이터 원장이 아니다.

녹취록과 AI 결과물은 원본 음성과 별도의 보관정책을 가질 수 있어야 한다. PDF 등 완성 문서는 기본적으로 기기에서 저장·공유할 수 있어야 하며 Cloud 보관은 선택적 기능으로 둔다.

---

# Decision 02 — 사용자 / Workspace / 데이터 소유권 모델

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

## 핵심 원칙

> **User는 사람이고 Workspace는 업무공간이다. 업무 데이터의 기본 소유 단위는 Workspace이며, 생성자·담당자 User와 원본 기기 소유권은 별도로 관리한다.**

### User와 Workspace

- 한 User는 여러 Workspace에 참여할 수 있다.
- 하나의 Workspace에는 여러 User가 참여할 수 있다.
- 모든 사용자는 Personal Workspace 1개를 기본으로 가진다.
- 사용자 UX에서는 Personal Workspace를 `내 업무`처럼 단순하게 표현할 수 있다.
- 초기에는 Personal Workspace 여러 개 생성을 기본 기능으로 제공하지 않는다.
- 추가 Workspace는 조직·팀·프로젝트 등 명확한 공동 업무공간으로 확장한다.

### 데이터 소유권

업무, 일정, CRM, 통화, 회의, 문서, Usage/Cost 등 핵심 업무 데이터는 원칙적으로 `workspace_id`를 가진다.

데이터 소속과 사람의 역할은 분리한다.

- `workspace_id`: 데이터가 소속된 업무공간
- `created_by_user_id`: 생성자
- `assigned_user_id`: 담당자

Personal Workspace 데이터는 개인 업무공간 소유, 조직/프로젝트 Workspace 데이터는 해당 Workspace 소유로 본다. 조직 멤버가 떠나도 조직 데이터는 남는다. User 탈퇴/멤버 제거와 Workspace 삭제는 별개다.

### 원본 파일과 업무 결과

조직 Workspace에서 처리했더라도 사용자의 휴대폰에 있는 원본 음성·사진은 Device Original로서 기본적으로 사용자 기기 원본이다. 반면 조직 업무를 위해 확정·공유한 통화 보고서, 업무, 일정, CRM 연결 등은 Workspace 데이터가 될 수 있다.

원본 자체를 조직 클라우드에 장기 보관하려면 별도 Workspace 정책과 사용자 고지가 필요하다.

### Membership / 권한

V1 최소 역할:
- `owner`: Workspace 중요 관리권한
- `member`: 일반 업무 사용권한

`admin`, `viewer` 등은 실제 필요 시 확장한다.

### Usage / Cost

Usage/Cost는 `workspace_id`와 `user_id`를 함께 기록해 전체/Workspace/사용자/기능/Provider별 비용을 모두 집계할 수 있게 한다.

Workspace별 보관·동기화 정책 확장을 허용하되 V1에서 과도하게 구현하지 않는다.

---

# Decision 03 — 모듈 공통 결과 계약과 Candidate → Confirmed 흐름

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

## 1. 모듈 고유 Result와 공통 업무 Candidate를 분리한다

각 모듈은 자기 고유 Result를 가진다.

예:
- `CallReport`
- `MeetingReport`
- `ScanDocument`
- `MailAnalysis`
- `CaptureAnalysis`

통화·회의·메일·캡처 등 서로 다른 모듈에서 업무수첩의 공통 행동을 발견하면 제각각 다른 형식으로 만들지 않고 공통 Candidate 계약으로 변환한다.

V1 우선 Candidate:
- `TaskCandidate`
- `ScheduleCandidate`
- `ContactCandidate`
- `FollowUpCandidate`

`DecisionCandidate` 등은 실제 필요가 생길 때 확장한다.

## 2. 모든 Candidate는 출처를 추적할 수 있어야 한다

공통 Candidate는 `SourceRef`를 통해 어디서 왜 만들어졌는지 추적 가능해야 한다.

예:
- 통화와 통화 ID / 녹음 시점
- 회의와 회의록 문단
- 메일 message reference
- 캡처 이미지
- 직접 음성/텍스트 입력

사용자가 `이 일정/업무가 왜 생겼지?`를 확인할 수 있어야 한다.

## 3. 기록은 관대하게, 실행은 신중하게

업무수첩은 완벽한 맞춤법이나 100% AI 정확도보다 **빠르게 놓치지 않고 기록하는 편의성**을 우선한다.

사소한 오타, 띄어쓰기, 음성인식 오류, 낮은 위험의 불완전한 표현 때문에 기록 자체를 막지 않는다.

사용자가 직접 말하거나 입력한 내용은 의미가 충분히 전달되면 우선 기록하고, 결과 바로 옆에서 쉽게 수정할 수 있게 한다.

예:

`음성 입력 → 약간의 오타가 있어도 저장 → 결과 옆 [수정] → 즉시 수정`

수정 기능은 깊은 메뉴에 숨기지 않고 자주 쓰는 결과 화면에서 빠르게 접근할 수 있는 UX를 기본으로 한다.

## 4. 사용자 명시 입력과 AI 추론을 구분한다

### 사용자 명시 입력

사용자가 직접 `내일 오후 3시 김대리 전화 일정 잡아줘`처럼 의도를 명확하게 말하거나 입력한 경우, 낮은 위험의 내부 기록은 편의성 우선으로 바로 생성할 수 있다.

이 경우 매번 불필요한 `정말 저장할까요?` 확인창을 강제하지 않고 저장 후 수정·삭제가 쉬운 UX를 우선한다.

### AI/규칙의 문맥 추론

통화·회의·메일·캡처에서 AI가 문맥을 해석해 발견한 업무·일정·연락처·후속조치는 기본적으로 Candidate로 제안한다.

예:

`통화 내용 → AI가 9월 17일 15시 미팅 추론 → ScheduleCandidate → 추가/수정/제외`

상대방의 일정이나 단순 논의를 사용자의 확정 일정/업무로 잘못 등록하지 않도록 한다.

## 5. Candidate와 Confirmed Record를 분리한다

Candidate는 제안이고 Confirmed Record는 실제 업무 데이터다.

예:
- `TaskCandidate → Task`
- `ScheduleCandidate → Schedule`
- `ContactCandidate → Contact/CRM relation`
- `FollowUpCandidate → FollowUp`

사용자가 승인하거나 명시적 자동화 규칙에 의해 확정된 뒤에는 실제 레코드로 전환한다.

## 6. Confirmed 데이터는 새로운 AI 추론보다 우선한다

사용자가 Candidate를 수정·확정한 값은 이후 AI 재분석 결과보다 우선한다.

예를 들어 AI가 `9월 17일 15:00`으로 추출했지만 사용자가 `9월 18일 14:00`으로 수정했다면, 재분석이 사용자의 확정값을 자동으로 덮어쓰지 않는다.

## 7. 위험도가 높은 외부 실행은 확인을 강화한다

편의성 우선 원칙은 모든 행동을 무확인 자동 실행한다는 뜻이 아니다.

특히 다음과 같은 고위험 행동은 별도 확인 또는 명시적 자동화 설정을 우선한다.

- 외부 사람에게 메시지/메일 전송
- 외부 Calendar에 중요한 일정 확정/변경
- CRM 고객 병합 또는 중요정보 변경
- 기존 업무/데이터 삭제
- 결제 또는 유료 처리 발생
- 조직 공유 데이터에 큰 영향을 주는 변경

반대로 메모 저장, 업무기록 초안, 통화보고서/AI 요약 저장 등 되돌리기 쉬운 낮은 위험 행동은 불필요한 확인 단계를 줄인다.

## 8. Auto-confirm은 명시적 사용자 규칙에 한해 확장한다

기본적으로 AI 문맥 추론은 Candidate다.

다만 사용자가 특정 입력·규칙·자동화에 명시적으로 동의한 경우 Auto-confirm을 허용할 수 있다.

예:
- 사용자가 직접 말한 명확한 일정 명령은 바로 내부 일정으로 저장
- 특정 자동화 규칙을 사용자가 켠 경우 제한적으로 자동 확정

Auto-confirm의 범위와 위험도 기준은 기능별로 명확히 정의한다.

## 9. 한 줄 기준

> **업무수첩은 기록을 완벽하게 만들기 위해 기록 자체를 늦추지 않는다. 사용자의 명시적 입력은 편의성 우선으로 빠르게 기록하고 쉽게 수정하게 하며, AI가 문맥에서 추론한 결과는 Candidate로 제안하고 중요한 외부 실행은 신중하게 확정한다.**

---

# 다음 결정 예정

## Decision 04 — 공통 Platform Services의 범위

다음 논의에서는 Auth/Permission, Storage, Processing Job, Retry/Idempotency, Usage/Cost, Sync, Retention/Audit 등 여러 모듈이 반복 구현하면 안 되는 공통 기능 중 무엇을 플랫폼 책임으로 두고, V1에서는 어디까지 구현할지 확정한다.
