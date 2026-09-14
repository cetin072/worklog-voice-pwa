# Worklog Voice PWA — 작업 기준

이 저장소는 실제 사용 중인 업무기록 PWA의 원본 저장소다.

## 핵심 목표

화려한 기능보다 `빠르게 말하고 확실히 Notion에 저장`되는 것이 우선이다.

## 문서 로딩 경량화

- 일반 작업은 현재 Issue/요청 + `AGENTS.md` + 직접 수정할 인접 파일/테스트만 확인한다.
- 큰 기능이나 여러 모듈 변경은 관련 planning/operations와 현재 PR/review를 추가로 확인한다.
- 아키텍처·보안·권한·배포 구조 변경에서만 중앙 공통 표준 원문을 반드시 다시 확인한다.
- 중앙 표준은 모든 작업의 상시 체크리스트가 아니라 아키텍처 판단과 감사의 상위 기준이다.

## 공통 웹 아키텍처 기준

- 웹 제작 공통 source of truth는 `cetin072/ai-development-system`의 `docs/WEB_ARCHITECTURE_STANDARD_V1.md`다.
- 핵심 원칙은 **Static by Default, Dynamic by Necessity**다.
- 이 앱은 동적 PWA이므로 JavaScript 사용 자체를 줄이는 것이 목표가 아니다.
- 앱을 열었을 때 핵심 녹음/입력/저장 진입점은 최초 App Shell에서 확정적으로 존재해야 한다.
- 별도 후처리 모듈이 실행되어야만 핵심 버튼이나 입력 UI가 생기는 구조를 사용하지 않는다.
- 음성 API, 네트워크, Notion 저장이 실패해도 사용자가 입력한 원문은 잃지 않아야 한다.
- loading / empty / error / retry 상태를 가능한 범위에서 명확히 구분한다.
- 비밀값과 중요한 검증은 클라이언트 JavaScript를 신뢰하지 않고 서버/Netlify 환경변수 등 신뢰 가능한 계층에서 처리한다.
- 기존 정상 동작 구조를 표준 준수만을 이유로 대규모 재작성하지 않고 Issue #28에서 위험도 순으로 감사·정비한다.

## 작업 시작 시

- 최신 `main`을 기준으로 현재 운영 상태를 확인한다.
- 기존 Issue / PR이 있으면 새로 시작하지 말고 해당 범위 안에서 이어간다.
- Notion DB 스키마와 Netlify 환경변수 이름을 임의로 바꾸지 않는다.

## 브랜치 / PR

- 일반 패치는 기능 브랜치에서 작업한다.
- Draft PR로 검수한다.
- 사용자 승인 없이 main 병합 또는 production 구조 변경을 하지 않는다.

## User Acceptance Ready

- 사용자 Preview 검수 직전 공통 기준은 `cetin072/ai-development-system/docs/USER_ACCEPTANCE_READY_GATE.md`다.
- `.github/workflows/user-acceptance-ready.yml`의 `User Acceptance Ready` 체크가 GREEN이 아니면 사용자에게 Preview/실사용 검수를 요청하지 않는다.
- UAR는 정적·회귀검사, 최소 초기상태 UI 계약, 정확한 PR HEAD Deploy Preview, 실제 Preview 환경 정합성, 실제 Preview 대표 smoke를 모두 통과해야 한다.
- Netlify `Deploy Preview ready`나 일반 `npm test` 성공만으로 사람 검수를 요청하지 않는다.
- 사람이 발견한 메뉴 누락, 로딩 실패, 버튼 미연결, 핵심 API 오류 등 기계적 문제는 QA Escape로 보고 회귀검사를 추가한 뒤 UAR 전체를 다시 실행한다.
- UAR 검사 자체는 실제 Notion/Kakao 데이터 쓰기나 Production 변경을 하지 않는 읽기 전용·비파괴 검증을 기본으로 한다.

## 보안

다음 값은 코드, 커밋, Issue, PR, 로그 예시에 절대 넣지 않는다.

- `NOTION_TOKEN`
- `APP_ACCESS_KEY`
- 기타 개인 액세스 토큰

비밀값은 Netlify 환경변수로만 관리한다.

## 유지해야 할 v1 동작

- 모바일 우선 UI
- Web Speech API + 키보드 음성입력 폴백
- 원문 확인 후 저장
- 기존 Notion `🎙 업무 통합 기록` 데이터 소스 사용
- AI API 없이 동작
- 저장 실패 시 사용자가 원문을 잃지 않도록 한다.

## 변경 우선순위

1. 기록 안정성
2. 입력 속도
3. 모바일 조작성
4. 보안
5. 자동분류 정확도
6. 부가기능
