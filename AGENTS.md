# Worklog Voice PWA — 작업 기준

이 저장소는 실제 사용 중인 업무기록 PWA의 원본 저장소다.

## 핵심 목표

화려한 기능보다 `빠르게 말하고 확실히 Notion에 저장`되는 것이 우선이다.

## 문서 로딩 경량화

- 일반 작업은 현재 Issue/요청 + `AGENTS.md` + 직접 수정할 인접 파일/테스트만 확인한다.
- 큰 기능이나 여러 모듈 변경은 관련 planning/operations와 현재 PR/review를 추가로 확인한다.
- 아키텍처·보안·권한·배포 구조 변경에서만 중앙 공통 표준 원문을 반드시 다시 확인한다.
- 중앙 표준은 모든 작업의 상시 체크리스트가 아니라 아키텍처 판단과 감사의 상위 기준이다.

## 업무수첩 제품·모듈 설계 기준

- 신규 범용 기능, 외부 연동, AI/STT/OCR/문서처리, Calendar/Notification 공급자 선택 전 `docs/planning/WORK_NOTE_OPEN_SOURCE_MODULAR_ARCHITECTURE_V1.md`를 우선 참조한다.
- 기본 판단 순서는 **Existing Platform/Core → 공식 SDK/API → 검증된 오픈소스 → Adapter/Service → 최소 자체 구현 → 필요 시 Fork**다.
- 범용 기능 재개발보다 사용자가 실제로 해야 하는 업무를 줄이는 기능과 업무수첩 고유의 업무 이해·연결·상태 판단·행동 전환 로직에 개발 역량을 우선 사용한다.
- 규칙·코드·DB·OS 기능으로 해결 가능한 문제에 생성형 AI를 기본 엔진으로 사용하지 않는다.
- 오픈소스/로컬 처리는 절대 규칙이 아니다. 보안, 정확도, 성능, 배터리, 유지보수, API 비용을 포함한 총비용으로 선택한다.

## 교체 가능성 Gate — 외부 엔진/오픈소스

- STT/OCR/AI/Calendar/Notification처럼 교체 가능성이 있는 외부 엔진은 반드시 `Core → 공통 Contract → Adapter/Registry → Provider` 경계를 유지한다.
- provider-specific import/type/model 경로는 UI, Data Core, 업무 규칙에 직접 노출하지 않는다.
- **엔진을 바꿀 때 UI·DB·업무 규칙을 수정해야 한다면 구조가 잘못된 것으로 보고 먼저 경계를 고친다.**
- 오픈소스 채택 전 라이선스, 최근 유지보수, Android/RN 호환성, binary/model 크기, 정확도, latency, 배터리/메모리, 장애 복구, 총운영비를 기록한다.
- 특정 provider 실패 시 Core를 재작성하지 말고 Adapter 구현만 교체하여 다음 후보를 검증한다.
- Quick Voice STT #353/#358 작업은 `docs/planning/CODEX_QUICK_VOICE_STT_EXECUTION_V1.md`를 실행 기준으로 추가 참조한다.

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

## 비용 / 외부 서비스 선택

- 모든 모듈은 **무료·오픈 표준·기존 인프라 재사용을 우선**한다.
- 유료 서비스가 필요하면 기능 적합성뿐 아니라 예상 월비용과 사용량 대비 가성비를 함께 비교한다.
- 무료 대안으로 요구사항을 충분히 만족할 수 있으면 유료 서비스를 기본값으로 선택하지 않는다.
- 신규 유료 서비스나 유료 플랜 의존성을 추가하기 전에는 무료 대안, 비용, 도입 이유를 사용자에게 먼저 제시하고 승인을 받는다.
- 가격이 변할 수 있는 외부 서비스는 도입 시점의 공식 가격을 다시 확인한다.

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
