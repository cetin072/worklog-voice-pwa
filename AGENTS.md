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


## Mobile 개발·검수 Fast Loop

- 모바일 UI/JS/TS 변경의 기본 검수 경로는 **Development Build 1회 설치 + Metro/Fast Refresh**다.
- 작은 화면/버튼/문구/StyleSheet/일반 TypeScript 변경마다 standalone Release APK를 다시 만들거나 사용자에게 재설치를 요구하지 않는다.
- 로컬 개발 기기 최초 설치는 `cd mobile && npm ci && npm run android:device`를 사용한다.
- 이후 native runtime이 그대로라면 `cd mobile && npm run start:device`로 Metro를 실행해 반복 검수한다.
- development build 재생성은 native dependency, Expo config plugin, Android permission/manifest, scheme/deep-link native config, Expo/RN native version, STT native runtime이 바뀔 때만 기본으로 한다.
- standalone ARM64 Release APK는 native-change checkpoint, milestone Human QA, release candidate에서만 생성한다.
- CI도 JS/TS-only 변경에서는 typecheck/contract regression을 우선하고 standalone APK 반복 생성을 피한다. 필요 시 manual workflow dispatch로 Release APK를 강제 생성한다.
- 이미 PASS했고 영향 파일/native contract가 바뀌지 않은 영역은 Human QA를 반복하지 않는다.
- 세부 기준은 `docs/planning/MOBILE_QA_FAST_LOOP_V1.md`를 따른다.

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

## 브랜치 / PR — 위험도 기반 운영

개발 속도와 안전성을 같이 잡기 위해 모든 수정에 PR을 강제하지 않는다.

### A. Lightweight Main Path — main 직접 반영 가능

아래 조건을 모두 만족하면 Codex/개발자는 별도 PR 없이 최신 `main`에 직접 반영할 수 있다.

- 문서, 오탈자, 문구, 주석, 테스트 보강, 단순 스타일/레이아웃 수정
- 또는 한 기능 안의 작고 국소적인 버그 수정
- DB schema / migration / 인증 / 권한 / 결제 / 비밀값 / 외부 API 계약을 바꾸지 않음
- native dependency / Expo config / Android permission / 앱 배포 설정을 바꾸지 않음
- 데이터 삭제·변환 등 비가역 작업이 없음
- 기존 사용자 데이터의 의미를 바꾸지 않음
- 변경이 쉽게 되돌릴 수 있음
- 관련 자동검사 또는 최소 회귀검사가 통과함

직접 main 반영 후에는 커밋 메시지에 변경 목적이 드러나게 하고, 문제가 발견되면 즉시 후속 커밋으로 수정하거나 revert한다.

### B. Branch + PR 필수

다음은 기능 브랜치 + PR로 작업한다.

- 신규 기능 또는 여러 화면/모듈에 걸친 변경
- STT/OCR/AI provider, Calendar/Notification, auth 등 외부 경계 변경
- DB migration / schema / RLS / RPC 변경
- native dependency, Expo config, Android/iOS 권한 또는 빌드 설정 변경
- production 동작, 배포, 비용, 보안에 영향이 있는 변경
- 삭제/대량수정/데이터 이동 등 되돌리기 어려운 변경
- 정확한 영향범위를 바로 설명하기 어려운 변경

### C. PR 누적 방지

- PR이 원래 목적을 넘어 다른 기능까지 포함하기 시작하면 새 작업을 더 넣지 않는다.
- 검증 가능한 체크포인트가 되면 Green + 필요한 Human QA 후 가능한 빨리 main에 병합한다.
- 미병합 PR 위에 또 다른 제품 PR을 연속으로 쌓는 stacked chain은 최소화한다.
- 현재 수정 대상 코드가 아직 open PR에만 존재하면 그 수정은 해당 PR에서 끝낸다. main에 일부만 복제하지 않는다.
- 큰 PR을 끝낸 뒤에는 다시 작은 `Issue → Branch/PR → QA → Merge` 주기로 돌아간다.

### D. 승인 경계

- Lightweight Main Path의 저위험 변경은 별도 병합 승인 없이 진행 가능하다.
- 큰 기능 PR, production 구조 변경, 유료 서비스, production secret, Play Store 제출, 비가역 데이터 변경은 사용자 승인 없이 진행하지 않는다.

## User Acceptance Ready — Web / Mobile 분리

- 사용자 Preview 검수 직전 공통 기준은 `cetin072/ai-development-system/docs/USER_ACCEPTANCE_READY_GATE.md`다.
- `.github/workflows/user-acceptance-ready.yml`의 `User Acceptance Ready`는 **Netlify Web/PWA Preview 준비 상태를 검증하는 Web gate**다.
- Web UAR GREEN을 Android/iOS 앱의 실행 가능성·버튼 동작·네이티브 API 안정성에 대한 보증으로 해석하지 않는다.
- Web/PWA 검수 요청 전에는 Web UAR GREEN이 필요하다.
- Mobile 실기기 검수 요청 전에는 별도의 Mobile gate가 필요하다: TypeScript + Android bundle/native build + runtime smoke + exact-head artifact.
- Netlify Deploy Preview나 일반 `npm test` 성공만으로 Mobile 실기기 검수를 요청하지 않는다.
- 사람이 발견한 메뉴 누락, 로딩 실패, 버튼 미연결, 핵심 API 오류 등은 QA Escape로 기록하되, 회귀검사는 실제 실패 계층과 같은 수준으로 추가한다. 런타임 문제를 source-text 정규식 검사만으로 닫지 않는다.
- UAR/Smoke는 실제 사용자 데이터 쓰기나 Production 변경을 하지 않는 읽기 전용·비파괴 검증을 기본으로 한다.

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
