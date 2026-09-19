# Stage 4 — Never Miss / 최소 알림·능동형 브리핑

기준일: 2026-09-20
추적 Issue: #384

## 1. 제품 목표

> 해야 할 일은 완료되거나 사용자가 다시 볼 시점을 정할 때까지 사라지지 않는다.

> 알림은 최소화하고, 앱을 열면 지금 챙겨야 할 것부터 보여준다.

Stage 4의 중심은 Push 확대가 아니라 **앱 내부 재노출(Resurface)** 이다.

## 2. 알림 원칙

- 기존 08:30 아침 Push / 16:30 미완료 Push를 기본 서버 Push 축으로 유지한다.
- V1에서 새 자동 Push 종류를 기본 추가하지 않는다.
- Push는 opt-in이며, 설정이 없으면 조용히 OFF 상태로 둔다.
- 정확한 일정 알림은 기존 모바일 Local Reminder/Calendar 경계를 재사용한다.
- 신규 일정 reminder 선택 UI는 **30분 전 / 1일 전** 중심으로 단순화한다.
- 기존 0/5/10/60분 preset은 기존 예약 호환 때문에 즉시 삭제하지 않고, 신규 선택 UI에서만 우선 숨긴다.
- 실사용 후 필요성이 없으면 내부 엔진 preset까지 후속 정리한다.

## 3. 사용자 개념 분리

### 미루기
업무 자체의 계획 변경.

- `due_at` 변경
- 브리핑/업무일지의 예정 시점도 변경

### 다시 알림
업무 기한은 유지하고 다시 확인할 시점만 변경.

- `due_at` 유지
- Stage 4 Attention Contract의 `next_attention_at` 변경

두 개념을 하나의 Snooze로 섞지 않는다.

## 4. 알림 설정 UX

모바일 설정에 **알림·리마인더** 별도 페이지/섹션을 둔다.

일상 옵션:
- 앱 알림 권한 상태
- 서버 Push 연결 상태
- 아침 업무 알림 ON/OFF
- 오후 미완료 알림 ON/OFF
- 일정 reminder 기본 선택

문제 해결:
- 테스트 알림
- 구독/권한/예약 진단
- 기기 설정 열기

문제 해결 영역은 Web 설정에서 검증된 것처럼 기본 접힘 상태로 둔다.

## 5. Web 업무수첩에서 재사용할 UX

- 홈 상단 `지금 확인할 것` + `전체 보기` 구조 유지
- 섹션 기본 3건 + N개 더 보기 (`MAX_VISIBLE=3`)
- 한 행: 핵심 내용 왼쪽 / 즉시 행동 오른쪽
- 상태는 대기/확인필요/후속조치 같은 작은 보조 태그
- 완료/확인했어요에서 검증된 Undo 문법을 가능한 행동에 재사용
- 흰 카드 / 큰 섹션 제목 / 작은 보조정보 / 색은 상태 표현에만 사용
- 새 Stage 4 분류 엔진명이 화면 디자인을 지배하지 않게 한다.

## 6. 외부 제품·오픈소스 벤치마킹

### Microsoft To Do
- Due date와 Reminder를 별도 사용자 개념으로 제공.
- Stage 4의 `미루기` / `다시 알림` 분리와 같은 방향.

### Todoist
- Settings > Reminders에서 알림 방식을 별도 관리.
- 자동 reminder를 끌 수 있음.
- 모바일 Snooze 간격을 별도 설정.
- 알림 설정을 메인 업무 화면에서 분리하는 방향을 참고.

### Vikunja
- Due date와 reminders를 별도 데이터로 관리.
- reminder는 absolute/relative를 분리.
- V1에서는 이 수준의 복잡한 상대 reminder 엔진을 도입하지 않고 데이터 개념만 참고.
- AGPL 코드 직접 복사/의존 없음.

### Super Productivity
- reminder preset 확대 요구와 모바일 알림 신뢰성 이슈가 지속적으로 확인됨.
- 많은 preset보다 적은 기본값과 전달 신뢰성을 우선하는 근거로 사용.
- 코드 의존 없음.

### Reminders 오픈소스
- 반복 reminder, 알림, 정렬/필터 등 일반 개념만 참고.
- GPL 계열 코드 직접 복사/의존 없음.

## 7. 개발 순서

### 4-0 Safety Gate
기존 notification scheduler 권한/보안 경계 정리.

### 4-1 Attention Contract
`due_at`과 별도 `next_attention_at` 최소 계약.

### 4-2 Resurface Engine
Push 없이 앱 내부에서 다시 보여줄 업무 판단.

### 4-3 미루기 / 다시 알림
업무 기한 변경과 attention 변경 UX 분리.

### 4-4 지금 확인할 것
홈 상단 최대 3건 중심의 능동형 브리핑.

### 4-5 알림·리마인더 설정
권한 / 서버 Push / 일정 Local Reminder / 진단 통합.

### 4-6 최소 Push 연결
기존 08:30 / 16:30을 재사용하고 새 자동 Push는 기본적으로 추가하지 않는다.

### 4-7 Never Miss E2E
완료/미루기/다시 알림/overdue/대기/재진입 통합검증.

## 8. 비목표

- 새 유료 Push SaaS
- 5분마다 반복 Push
- 모든 업무 exact alarm
- 위치 기반 reminder
- Kakao/SMS/Email 신규 알림 채널
- AI 중요도 점수 기반 Push
- Stage 3 업무일지 재작성
- 복잡한 반복업무 엔진

## 9. 개발 운영

- 각 4-x는 별도 Issue + Branch + PR.
- 기존 정상 경계와 UX를 우선 재사용한다.
- Production DB/권한 변경은 해당 단계 코드/자동검증 완료 후 적용·검증한다.
- 한 단계 완료 후 다음 단계로 진행한다.


## 10. 벤치마킹 참고 링크

- Microsoft To Do — Due dates and reminders:
  - https://support.microsoft.com/en-us/todo/add-due-dates-and-reminders-in-microsoft-to-do
- Todoist — Reminders / automatic reminders / mobile snooze:
  - https://www.todoist.com/help/todoist/features/introduction-to-reminders-9PezfU
- Vikunja — Dates & Reminders:
  - https://vikunja.io/help/dates-and-reminders/
- Super Productivity — Custom Reminders discussion:
  - https://github.com/super-productivity/super-productivity/issues/6531

외부 코드는 직접 복사하지 않고 제품 개념과 UX 패턴만 참고한다.
