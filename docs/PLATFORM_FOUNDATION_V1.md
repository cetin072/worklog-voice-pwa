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

# 다음 결정 예정

## Decision 04 — 공통 Platform Services의 범위

다음 논의에서는 Auth/Permission, Storage, Processing Job, Retry/Idempotency, Usage/Cost, Sync, Retention/Audit 등 여러 모듈이 반복 구현하면 안 되는 공통 기능 중 무엇을 플랫폼 책임으로 두고, V1에서는 어디까지 구현할지 확정한다.
