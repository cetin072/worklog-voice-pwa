# 업무수첩 Platform Foundation V1

## 문서 상태

- 상태: 작성 중
- 기준 Issue: #91
- 목적: 업무수첩의 각 독립 모듈이 하나의 상용 제품으로 결합될 때 공통으로 따라야 할 플랫폼 기준을 정의한다.
- 기록 원칙: 종합 기획에서 하나의 주제가 확정될 때마다 이 문서에 즉시 반영한다. 채팅 기록을 장기 기준으로 사용하지 않는다.

이 문서는 제품 최상위 원칙인 `PROJECT_CHARTER.md`와 모듈 경계 기준인 `docs/MODULE_ARCHITECTURE_V1.md` 아래에서, Auth·Workspace·데이터 소유권·동기화·공통 Result/Service 등 실제 플랫폼 기반의 공통 규칙을 구체화한다.

---

# Decision 01 — 데이터 원본과 저장소 역할

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

## 1. 최상위 저장 철학: Local-first

업무수첩은 사용자 콘텐츠에 대해 **Local-first**를 기본 철학으로 한다.

사용자가 직접 만든 원본과 업무수첩이 생성한 개인 업무 결과물은 가능한 한 사용자 기기에서 먼저 저장하고 사용할 수 있게 한다.

클라우드는 모든 사용자 콘텐츠를 강제로 소유하는 단일 원본 창고가 아니라 다음 기능을 제공하는 계층으로 본다.

- 계정과 권한
- 동기화
- 복구
- 여러 기기 사용
- 검색과 관계 연결
- 조직/협업
- 중앙 처리상태와 시스템 운영

단, Local-first는 `기기 하나에만 저장한다`는 뜻이 아니다. 현재 PWA의 브라우저 저장공간은 브라우저 데이터 삭제, 기기 분실·교체 등으로 유실될 수 있으므로 이를 유일한 영구 보관소라고 보장하지 않는다.

복구와 다기기 사용이 필요한 콘텐츠는 선택적 또는 제품 시나리오에 따른 Cloud Sync/Backup을 제공한다.

## 2. 데이터 계층 용어

### Device Original

사용자가 직접 생성하거나 보유한 물리적 원본이다.

예:

- 통화 원본 음성
- 회의 원본 음성
- 원본 사진
- 스캔 전 사진
- 화면 캡처

기본 위치는 사용자 기기다.

### Local Canonical Copy

업무수첩이 처리하여 만든 사용자 소유 결과물 중 기기에서 우선 보관·사용할 수 있는 결과다.

예:

- 전체 녹취록
- AI 요약
- 통화 보고서
- 회의록
- 스캔 PDF
- 사용자가 확정·수정한 개인 업무 결과물

이 결과물은 외부 저장소 장애 때문에 생성 직후 사라지지 않아야 한다.

### Cloud Synced Copy

복구, 여러 기기 사용, 검색, 관계 연결, 협업 등을 위해 클라우드에 동기화한 사용자 콘텐츠 사본이다.

모든 사용자 콘텐츠를 무조건 클라우드에 영구 저장하지 않는다. 동기화 범위는 데이터 성격, 제품 기능, 사용자 선택과 조직 정책에 따라 정한다.

### System Record

중앙 조정과 서버 기준이 필요한 시스템 운영 데이터다.

예:

- Auth
- User / Workspace membership
- Permission
- Processing Job
- Retry / Idempotency
- Usage / Cost
- Sync 상태
- 중앙 시스템 메타데이터

이 데이터는 서버/업무수첩 전용 백엔드를 기준으로 한다.

## 3. 사용자 기기의 역할

사용자 기기는 다음 데이터의 기본 원본 또는 1차 결과 저장 위치다.

- 원본 음성
- 원본 사진
- 원본 캡처
- 스캔 PDF
- 녹취록
- AI 요약/보고서
- 회의록 등 사용자 소유 결과물

업무수첩이 원본 음성·사진을 사용자 동의 없이 전체 자동 백업하는 것을 기본값으로 하지 않는다.

향후 원본 클라우드 보관 기능을 제공하더라도 별도 기능과 명시적 정책으로 취급한다.

## 4. 처리용 Object Storage의 역할

STT, OCR, AI 등 처리를 위해 서버 업로드가 필요한 대용량 파일은 private Object Storage를 처리용 임시공간으로 사용한다.

기본 정책:

1. 사용자가 처리할 파일을 명시적으로 선택한다.
2. private 임시 Storage에 업로드한다.
3. STT/OCR/AI 처리를 수행한다.
4. 필요한 결과 저장이 성공했음을 확인한다.
5. 정상 성공 시 원본 처리 파일을 즉시 삭제한다.
6. 실패 시 짧은 재처리 유예를 둘 수 있다.
7. 임시 파일의 절대 보관 상한은 기본 24시간으로 한다.
8. 정상 삭제 로직과 별도로 만료 파일 청소 작업을 둔다.

Object Storage는 기본적으로 사용자의 원본 파일 영구 보관소가 아니다.

실제 공급자는 Supabase Storage, S3/R2 계열 등으로 교체할 수 있도록 Storage Adapter 뒤에 둔다.

## 5. Supabase의 역할

Supabase를 `파일을 쌓아두는 클라우드 드라이브`로 정의하지 않는다.

업무수첩에서 Supabase는 우선 **앱 백엔드 기반** 역할을 담당한다.

주요 책임 후보:

- Auth
- 사용자 식별
- Workspace
- 권한/RLS
- 관계형 데이터
- Processing Job
- Retry / Idempotency
- Usage / Cost
- Sync 상태
- 시스템 메타데이터
- 필요 시 사용자 콘텐츠의 Cloud Sync/Backup

사용자 콘텐츠를 반드시 전부 Supabase에 영구 저장해야 하는 것은 아니다.

Supabase 고유 스키마나 API가 통화·회의·스캐너 등 도메인 모듈의 내부 데이터 계약을 지배하지 않게 한다.

향후 Google Cloud, AWS, 다른 PostgreSQL 또는 다른 저장소로 교체하더라도 핵심 모듈을 대규모 재작성하지 않도록 Adapter/Repository 경계를 유지한다.

## 6. 현재 Notion의 역할과 장기 방향

현재 운영 중인 기존 업무기록은 Notion `🎙 업무 통합 기록`을 실제 원장으로 유지한다.

Platform Foundation을 이유로 기존 정상 업무기록을 즉시 Supabase로 이전하지 않는다.

장기적으로는 업무수첩 자체 기능이 충분히 성숙했을 때 Notion을 선택적 Adapter/동기화 대상으로 전환할 수 있다.

해당 전환은 자동으로 일어나지 않으며 별도의 명시적 제품 결정과 Migration 검증을 필요로 한다.

따라서 전환기에는 데이터 종류별 원장이 다를 수 있다.

예:

- 기존 업무기록: 현재 Notion
- 사용자 원본 음성/사진: 사용자 기기
- 사용자 결과물: Local-first
- Processing Job / Usage / Cost / Auth: 업무수첩 서버/Supabase

## 7. Google Calendar 및 외부 업무도구

Google Calendar 등 외부 업무도구는 업무수첩 내부 데이터 모델을 지배하지 않는 Adapter다.

업무수첩 내부 표준 데이터가 먼저 존재하고 외부 서비스 형식은 Adapter에서 변환한다.

예:

`ScheduleCandidate / Confirmed Schedule → Calendar Adapter → Google Calendar`

초기에는 복잡한 양방향 동기화보다 명확한 단방향 또는 제한된 동기화를 우선할 수 있다. 양방향 동기화가 필요해질 때 충돌, 삭제, 반복일정, timezone, version 정책을 별도로 설계한다.

## 8. STT / AI / OCR 공급자의 역할

STT, AI, OCR 공급자는 **Processor**이며 데이터 원장이 아니다.

기본 흐름:

`업무수첩 데이터 → 처리 요청 → 외부 Processor → 결과 반환 → 내부 표준 결과로 정규화`

공급자 선정 시 다음 항목을 별도로 검토한다.

- 입력 데이터 보관기간
- 모델 학습 사용 여부
- 삭제 정책
- 개인정보 처리조건
- 처리 지역
- 비용

공급자 변경이 Module UI와 핵심 도메인 로직의 대규모 수정으로 이어지지 않게 한다.

## 9. 녹취록과 AI 결과물의 개인정보 원칙

원본 음성을 처리 후 삭제해도 녹취록에는 동일하거나 더 검색하기 쉬운 민감정보가 남을 수 있다.

따라서 녹취록과 AI 요약/보고서는 원본 음성과 별개의 보관정책을 가질 수 있어야 한다.

향후 지원 가능한 예:

- 계속 보관
- 일정 기간 보관
- 요약 생성 후 전체 녹취 삭제
- Cloud Sync 사용 안 함

구체적인 기본 보관기간과 사용자 설정 UX는 별도 개인정보/Retention 결정에서 확정한다.

## 10. PDF와 생성 문서

스캔 PDF 등 사용자가 만든 완성 파일은 기본적으로 기기에서 저장·공유할 수 있어야 한다.

Cloud 문서함/백업이 필요한 경우 사용자가 선택하거나 해당 기능 정책에 따라 Cloud Storage에 동기화한다.

PDF 생성 성공과 OCR, Notion 첨부, 업무 연결 성공은 같은 성공조건으로 취급하지 않는다.

## 11. 로컬 브라우저 저장소의 역할

현재 PWA에서는 IndexedDB/LocalStorage 등을 다음 용도로 사용할 수 있다.

- 작성 중 임시 저장
- Local-first 결과 저장
- 실패 복구
- 업로드 대기
- 오프라인 Queue
- 설정/캐시
- 동기화 대기상태

다만 현재 브라우저 저장공간을 `절대 삭제되지 않는 유일한 정식 원본`이라고 약속하지 않는다.

네이티브 앱으로 확장할 경우 SQLite 등 더 강한 로컬 DB를 같은 플랫폼 계약 아래 검토할 수 있다.

## 12. 시스템 데이터는 Cloud-first

다음 데이터는 여러 기기와 사용자 전체에서 일관된 중앙 기준이 필요하므로 Local-only로 두지 않는다.

- Auth
- Workspace / Membership
- Permission
- Usage / Cost
- Processing Job
- Retry / Idempotency
- 중앙 Sync 상태
- 과금/운영에 필요한 시스템 메타데이터

특히 Usage / Cost는 여러 사용자와 기기의 총 사용량을 집계해야 하므로 서버 원장을 사용한다.

## 13. 한 줄 기준

> **사용자 콘텐츠는 Local-first, 시스템 운영 데이터는 Cloud-first. 클라우드는 사용자 콘텐츠의 강제 원본 창고가 아니라 필요에 따라 동기화·복구·협업을 제공하는 계층으로 사용한다.**

---

# Decision 02 — 사용자 / Workspace / 데이터 소유권 모델

- 상태: **확정**
- 확정일: 2026-09-13
- 변경 원칙: 별도의 중대한 기술·사업·보안상 대안이 생기지 않는 한 기본 플랫폼 원칙으로 유지한다.

## 1. User와 Workspace를 분리한다

업무수첩의 **User는 사람**, **Workspace는 업무 데이터가 소속되는 업무공간**이다.

한 User는 여러 Workspace에 참여할 수 있고, 하나의 Workspace에는 여러 User가 참여할 수 있다.

예:

- User: 한 사람의 업무수첩 계정
- Personal Workspace: 개인 업무공간
- Organization/Project Workspace: 회사·팀·프로젝트 업무공간

Google Workspace와 유사하게 `사람`과 `업무공간`을 분리하되, 업무수첩 Workspace는 업무수첩 내부 데이터의 소유권·권한·비용·협업 경계를 정의하는 논리적 공간이다.

## 2. 모든 사용자는 Personal Workspace 하나를 기본으로 가진다

회원가입 또는 정식 사용자 생성 시 Personal Workspace 하나를 자동 생성하는 방향을 기본값으로 한다.

사용자 UX에서는 이를 반드시 `Workspace`라는 기술용어로 노출할 필요는 없으며 `내 업무`처럼 단순하게 표현할 수 있다.

초기에는 Personal Workspace를 여러 개 만드는 기능을 기본으로 제공하지 않는다.

추가 Workspace는 조직·팀·프로젝트 등 명확한 공동 업무공간 용도로 확장한다.

## 3. 업무 데이터의 기본 소유 단위는 Workspace다

업무수첩의 핵심 업무 데이터는 원칙적으로 `workspace_id`를 가진다.

대상 예:

- 업무/할 일
- 일정
- 고객/CRM
- 통화 및 통화 보고서
- 회의 및 회의록
- 문서 메타데이터
- 확정된 업무 연결 정보
- Usage/Cost 집계

데이터가 어느 Workspace 소속인지와 누가 만들었는지는 별도 개념으로 관리한다.

예:

- `workspace_id`: 데이터가 소속된 업무공간
- `created_by_user_id`: 생성한 사용자
- `assigned_user_id`: 담당 사용자

필요한 도메인에만 추가 사용자 관계를 둔다.

## 4. 개인 데이터와 조직 데이터를 구분한다

Personal Workspace의 업무 데이터는 해당 개인 업무공간 소유로 본다.

Organization/Project Workspace에서 생성된 업무 데이터는 생성자의 개인 소유가 아니라 해당 Workspace 소유로 본다.

예를 들어 조직 Workspace에서 한 사용자가 통화 보고서를 만들었다면:

- 생성자: 해당 User
- 업무상 데이터 소유: 해당 Workspace

멤버가 조직을 떠나거나 계정을 해지하더라도 조직 Workspace의 업무 데이터가 함께 삭제되어서는 안 된다.

따라서 `User 탈퇴/멤버 제거`와 `Workspace 삭제`는 서로 다른 작업으로 취급한다.

## 5. Device Original과 Workspace 업무결과의 소유권을 구분한다

Decision 01의 Local-first 원칙을 유지한다.

조직 Workspace에서 통화 분석을 수행했더라도 사용자의 휴대폰에 존재하는 원본 통화녹음·사진 등 Device Original은 기본적으로 사용자 기기 원본이다.

반면 사용자가 조직 업무를 위해 확정·공유한 업무 결과는 Workspace 데이터가 될 수 있다.

예:

`사용자 휴대폰 원본 통화녹음 → 통화 분석 → 조직 Workspace 통화 보고서 / 업무 / 일정 / CRM 연결`

원본 음성 자체를 조직 클라우드에 장기 보관하려면 별도 Workspace 정책과 사용자 고지를 필요로 한다.

## 6. Membership과 최소 권한 모델

Workspace 멤버십은 별도 관계로 관리한다.

V1 최소 역할은 다음 두 가지를 기본으로 한다.

- `owner`: Workspace 소유 및 멤버/설정/삭제 등 중요 관리권한
- `member`: 일반 업무 사용권한

`admin`, `viewer` 등 세분화된 역할은 실제 요구가 생길 때 추가한다.

권한 모델은 처음부터 확장 가능하게 설계하되, 현재 단계에서 과도한 역할 체계를 만들지 않는다.

## 7. Usage / Cost는 Workspace와 User를 함께 기록한다

사용량과 비용은 `workspace_id`와 `user_id`를 함께 기록하는 것을 기본으로 한다.

이렇게 해야 다음 집계가 모두 가능하다.

- 전체 서비스 비용
- Workspace별 비용
- 사용자별 비용
- Workspace 안의 사용자별 비용
- 기능/Provider별 비용

한 User가 Personal Workspace와 조직 Workspace 양쪽에서 유료 기능을 사용하더라도 비용을 정확히 분리할 수 있어야 한다.

## 8. CRM과 담당자도 소유와 담당을 분리한다

고객/CRM 데이터는 Workspace 소유를 기본으로 한다.

고객 담당자는 별도 User 관계로 기록한다.

예:

- `customers.workspace_id`: 고객 데이터의 업무공간 소유권
- `assigned_user_id`: 현재 담당자

담당자가 바뀌어도 고객 데이터 자체의 소유권이 이동하거나 사라지지 않는다.

업무와 일정도 같은 원칙으로 `소속 Workspace`, `생성자`, `담당자`를 구분한다.

## 9. Workspace별 정책 확장을 허용한다

개인과 조직은 데이터 보관·동기화 요구가 다를 수 있으므로 향후 Workspace 단위 정책을 지원할 수 있게 한다.

예:

- 원본 음성 Cloud Backup 허용 여부
- 녹취록 Cloud Sync 여부
- 보고서 Cloud Sync 여부
- 보관기간
- 외부 Calendar/Notion 연동 정책

구체적인 정책 필드와 기본값은 필요성이 확정될 때 설계한다. V1에서 미리 과도하게 구현하지 않는다.

## 10. 최소 개념 모델

플랫폼은 최소한 다음 관계를 수용할 수 있어야 한다.

```text
User
 ├─ Personal Workspace (기본 1개)
 └─ Membership ──> Organization / Project Workspace

Workspace
 ├─ Members
 ├─ Tasks
 ├─ Schedules
 ├─ Customers / CRM
 ├─ Calls / Meetings
 ├─ Documents
 └─ Usage / Cost
```

구현 시 실제 테이블 이름은 별도 기술설계에서 정하지만, 제품 계약은 위 관계를 유지한다.

## 11. 한 줄 기준

> **User는 사람이고 Workspace는 업무공간이다. 업무 데이터의 기본 소유 단위는 Workspace이며, 생성자·담당자 User와 원본 기기 소유권은 별도로 관리한다.**

---

# 다음 결정 예정

## Decision 03 — 모듈 공통 결과 계약과 Candidate → Confirmed 흐름

다음 논의에서는 통화·회의·메일·캡처 등 서로 다른 모듈이 발견한 업무·일정·연락처를 제각각 다른 형식으로 만들지 않도록 공통 Result/Candidate 계약과 사용자 확인 원칙을 확정한다.
