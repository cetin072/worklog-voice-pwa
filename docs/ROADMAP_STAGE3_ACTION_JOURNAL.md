# Stage 3 — Action Engine + 자동 업무일지 확정 로드맵

기준일: 2026-09-19  
기준 main: `beef5a1e9bd9c339c11c4362cf94e284c5e11e37`  
추적 Issue: #368

## 1. 제품 목표

Stage 3의 목표는 단순 분류기가 아니다.

> **말한 내용을 해야 할 행동으로 바꾸면서, 날짜별 업무일지도 자동으로 완성한다.**

화면 원칙은 두 문장으로 고정한다.

> **브리핑은 지금 챙겨야 할 것만 보여준다.**

> **업무일지는 쓰지 않아도 날짜별로 자동 완성된다.**

## 2. 사용자 UX

### Schedule
- 기존 일정 UX를 그대로 사용한다.
- 시간 자체가 일정의 시각적 구분 역할을 한다.
- 내부 엔진명 `Schedule`을 사용자에게 강조하지 않는다.

### Task
- 기존 브리핑 업무 UX를 그대로 사용한다.
- 오른쪽 `완료` 버튼 자체가 "해야 할 일"이라는 의미가 된다.
- 내부 엔진명 `Task`를 별도 배지로 노출하지 않는다.

### Note
- 브리핑에 `메모 · 참고` 섹션을 추가한다.
- 기본 3개만 보이고 나머지는 `N개 더 보기`로 밀도를 제어한다.
- 주행동은 `확인했어요`.
- `확인했어요`를 누르면 브리핑에서는 내려가지만 업무일지와 검색에서는 유지한다.
- 처리 직후 `실행 취소`를 제공한다.
- Task ↔ Note 전환은 상세 수정 안에서 제공하고 메인 화면을 복잡하게 만들지 않는다.

## 3. 자동 업무일지

업무일지는 별도 페이지지만 별도 복사본 데이터 저장소가 아니다.

같은 `work_records`와 `schedules`를 날짜별로 재구성해 보여준다.

기본 섹션:
- 일정 · 미팅
- 한 일
- 업무 중 확인사항
- 남은 업무

날짜 정책:
- 날짜 언급 없음 → 오늘
- 과거 날짜 표현 → 해당 과거 날짜 업무일지 갱신
- 미래 날짜 표현 → 해당 날짜에 `예정`으로 미리 표시
- 이후 완료/확인 상태가 바뀌면 같은 원본을 기준으로 업무일지 표현도 자동 갱신

업무일지는 사용자가 매일 새 문서를 작성하는 화면이 아니다.
이미 자동 완성되어 있고 필요할 때만 고친다.

## 4. 데이터 원칙

`recorded_at`과 `journal_date`는 다른 개념이다.

- `recorded_at`: 실제로 입력/녹음한 시각
- `journal_date`: 어느 날짜의 업무일지에 속하는지
- `due_at`: 해야 하는 기한
- `completed_at`: Task가 실제 완료된 시각
- `acknowledged_at`: Note를 `확인했어요` 처리한 시각

`action_kind`:
- `task`
- `note`
- null: Stage 3 이전 legacy / 아직 분류하지 않은 기록

Schedule은 기존 `schedules` entity를 사용한다. `work_records.action_kind`에 `schedule`을 억지로 넣지 않는다.

`briefing_state`:
- `active`
- `acknowledged`

Stage 4 Never Miss에서 Snooze가 필요해지면 별도 확장한다.

## 5. 기존 기록 호환성

- 기존 기록을 억지로 Task/Note로 추정해 backfill하지 않는다.
- 기존 `action_kind`는 null 허용.
- 기존 `journal_date`는 `recorded_at`의 Asia/Seoul 날짜로 안전하게 초기화한다.
- Stage 3 Action Engine이 처리하는 신규 기록부터 명시적 `action_kind`와 semantic `journal_date`를 쓴다.
- 원본 `original_text`는 계속 보존한다.

## 6. Korean Date Engine

현재 `netlify/shared/schedule-extract.mjs`의 한국어 날짜/시간 파서를 버리지 않고 공통화한다.

### Schedule 정책
- 미래 일정 생성에 맞는 기존 보수적 정책 유지.

### Journal 정책
- 과거/현재/미래를 모두 해석.
- `어제`, `그제`, `지난 금요일`, `지난주 화요일` 등 과거 표현 추가.
- 일정 파서의 "지난 월일이면 다음 해" 미래 편향을 업무일지에는 적용하지 않는다.

## 7. Multi-action Splitter

웹 `public/quick-save.js`의 명시적 구분어 패턴을 재사용한다.

예:
- 다음 업무
- 그다음
- 다음 건
- 또 다른 업무
- 별도 업무
- 두 번째 업무

하나의 Voice 원본은 그대로 보존하고, 분리된 Action들이 원본을 참조한다.

## 8. 웹 UX 벤치마킹 반영

3단계에도 다음 패턴을 유지한다.
- 섹션별 카운트와 상태별 시각 구분
- 한 행: 핵심정보 왼쪽 + 즉시 행동 오른쪽
- 일정은 시간 자체를 주요 라벨로 사용
- 각 섹션 기본 3개 + 더 보기
- 완료/확인 후 Undo

## 9. 오픈소스 사용 원칙

Stage 3 V1에는 새 라이브러리를 기본 도입하지 않는다.

후보:
- `react-native-calendars`: 월간 날짜 점프가 실제로 필요해질 때
- `react-native-gesture-handler`: Swipe 단축동작이 필요해질 때
- `FlashList`: 실제 대용량 성능 문제가 확인될 때

사용하지 않음:
- `chrono-node`: 한국어 자연어 날짜 파싱을 지원하지 않아 핵심 날짜 엔진에 부적합

V1은 기존 RN primitives, 현재 theme, 기존 Korean date parser를 우선한다.

## 10. 개발 순서

1. **3-1 Data Contract**
   - action_kind
   - journal_date
   - briefing_state
   - completed_at
   - acknowledged_at
2. **3-2 Korean Date Engine**
3. **3-3 Action Engine V1**
4. **3-4 Multi-action Splitter**
5. **3-5 Briefing UX**
6. **3-6 자동 업무일지 V1**
7. **3-7 수정/전환**

## 11. 승인 경계

- 이 로드맵 자체는 사용자 최종 승인 완료.
- 각 단계는 별도 branch + PR + 테스트로 진행.
- main merge는 사용자 명시 승인 전 금지.
- production DB migration 적용은 사용자 명시 승인 전 금지.
- physical-device QA는 별도 요청이 없는 한 자동 CI/Android gate 이후로 미룬다.
