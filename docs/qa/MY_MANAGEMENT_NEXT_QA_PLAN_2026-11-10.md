# 내 관리 — DB 적용 및 누적 QA APK 준비

현재 승인 범위는 코드 보완·자동검수·적용 계획·빌드 준비다. 이 문서의 실행 명령은 준비 자료이며 원격 DB 적용·APK dispatch·설치·운영 배포는 실행하지 않았다.

## 이번 보완과 실행 근거

습관 보완 제품 커밋은 #536 `052ef36158f118e650acdb128b0825e6ac5f04f0`이다.

기준 소스는 #537 `b1c166e591d47824e137e6f1dbac27cacf28a15f`다. 기존 #525/#532 변경과 다른 작업자의 수정은 유지한다. 습관 체크가 확인된 뒤 늦은 재조회가 0회로 덮어쓰는 문제를 production TSX 검사에서 재현한 후 수정했다. 새 조회·확인된 저장·화면 종료 때 이전 조회 응답을 무효화한다. 초기 조회 전에 등록한 경우에는 확인 후 전체 목록을 다시 읽는다. 조회 오류와 실제 빈 목록 안내도 구분한다.

- 최신 통합 제품 코드 `npm test`: **1,308 PASS / 실패·생략 0**. 실제 migration을 사용하는 격리 PGlite 검사 포함.
- `cd mobile && npm run typecheck`: PASS. QA variant Android Metro export도 PASS(설치/서버 연결 증거 아님).
- 지난 Windows 환경에서 막혔던 사진 XML 검사: 이 Linux 환경에서 PASS. 실제 Android 사진 선택 성공 근거는 아니다.
- 패널 상태·뒤로가기 및 습관 10터치/취소/늦은 조회 회귀 검사 PASS.
- 최종 화면 After 캡처·Android 설치/알림 전달·ERP 인증 후 화면은 여전히 미실행.

## DB 변경 후보 고정

대상은 QA와 운영이 공유하는 `jgsxpdflgkqroecfjzxq`, schema `worklog`다. 이번 읽기 전용 확인에서 기존 `20261109125845`/`20261109144344`만 존재했다. 아래 신규 migration과 새 테이블·ERP 조회 함수는 없다. 실제 사용자 행을 조회/수정하지 않았다.

| 적용 순서 | 파일 | SHA-256 |
|---|---|---|
| 1 | 20261109232907_regular_expenses_v1.sql | 9365d350db197797ab17a3eedca82bcee8c4f8477fff63be9600aa926396c53e |
| 2 | 20261109233147_repeating_work_v1.sql | e4278a4a83d756bf099ee18d11a5ae2315912c91a37a1a6199192cb2f8836a53 |
| 3 | 20261109234334_habits_v1.sql | 2dd21b8b6403ddf151bfeb6480fdc2d30e7e11f4ef72971554295323c314a0dc |

1은 기존 subscriptions에 유형/예상액 필드와 납부 영수증을 추가한다. 2는 반복 규칙·요청 영수증·읽기/변경 RPC와 기존 work_records 보호 trigger 2개를 추가한다. 3은 독립 습관·체크·요청 영수증을 추가한다. 과거 기록 일괄 변환/삭제와 미래 회차 사전 생성은 없다. 종료는 보관이며 계정 삭제의 cascade와 구분한다.

### 적용 직전 읽기와 중단 조건

[읽기 전용 preflight SQL](MY_MANAGEMENT_DB_PREFLIGHT.sql)은 사용자 행을 읽지 않고 기존 열/정책/권한/trigger 및 후보 객체 충돌을 확인한다. 연결 project ref는 SQL만으로 보증할 수 없으므로 도구의 명시 project_id와 같이 기록한다.

- 기존 두 migration은 재적용하지 않는다. 새 version 또는 같은 이름의 객체가 하나라도 이미 있으면 그대로 실행하지 않고 실제 정의와 migration 이력을 대조한다.
- SQL hash가 위와 다르거나 원본 work_records 권한/열이 달라졌으면 계획을 다시 검토한다.
- backup/PITR 활성 상태·복원 가능 시점·복구 절차는 **미확인**이다. 공급자 화면/메타데이터로 확인한 뒤 복구 책임자와 복원 지점을 기록해야 한다. 사용자 데이터 복사본을 공개 저장소에 넣지 않는다.
- 보호 trigger는 반복으로 연결된 원본의 일반 수정/완료/삭제를 거부한다. 새 API의 409 안내가 준비되었는지 확인하고, 구버전 앱·ERP의 수정 경로를 점검한 뒤 적용한다.
- 실제 사용자 기록으로 합성 시험을 하지 않는다. RLS·동시 요청·종료 보존·Undo는 동일 hash의 격리 DB 실행 결과로 검토한다.

### 승인 후 적용과 확인 순서

선택한 후보 SHA를 고정하고 일반 `db push`로 저장소의 모든 미적용 migration을 한꺼번에 적용하지 않는다. 승인된 파일을 위 순서로 한 migration당 트랜잭션 하나에 적용한다. lock_timeout 5초와 statement_timeout 30초를 적용 세션/트랜잭션에서 설정하고, 오류 시 그 단계 rollback 후 다음 단계 진행을 중단한다. 실제 migration 도구가 SQL 전체와 이력 기록을 한 트랜잭션으로 처리하는지 실행 전 확인한다.

각 단계 후 version/name·객체·RLS 활성·owner 정책·anon 금지·authenticated 최소 권한·함수 security invoker와 search_path를 metadata로 확인한다. 부분 적용을 전체 성공으로 표시하지 않는다. 기존 사용자 데이터 불변 확인이 필요하면 비공개 DB 내부에서만 집계/해시를 비교하며 원문을 출력하지 않는다.

복구는 새 기능 사용 중단과 직전 클라이언트/API 복귀를 우선한다. trigger의 구버전 호환 문제가 있으면 승인된 해당 trigger/함수 정의만 복구한다. 새 이력 테이블 DROP, 사용자 행 삭제, 계정 초기화를 복구 수단으로 사용하지 않는다. 다른 서비스까지 공유하는 전체 DB 복원은 별도 영향 검토가 필요하다.

## QA 빌드 입력과 서버 차단 사항

- 기존 workflow: `.github/workflows/mobile-foundation.yml` / `Mobile App`.
- ref: `qa/my-management-integrated`; dispatch 직전 원격 head 40자리 SHA를 고정한다. 빌드 동안 ref가 움직이면 artifact의 sourceSha와 실제 checkout을 대조해 다르면 폐기하고 설치하지 않는다.
- 입력: `build_android=true`, `qa_api_base_url=https://deploy-preview-537--worklog-voice-pwa.netlify.app`.
- **현재 이 URL의 `/api/supabase-auth-config`는 HTTP 404다.** Netlify 최근 목록에도 #537 배포가 없었다. 서버가 준비됐다고 가정하거나 운영 주소로 자동 대체하지 않는다. 승인된 QA 서버 주소·배포 SHA를 먼저 확보하고 auth-config의 host가 `jgsxpdflgkqroecfjzxq.supabase.co`, dataSchema가 `worklog`인지 비밀키를 출력하지 않고 확인한다.
- Preview 주소도 DB 격리를 뜻하지 않는다. 정상 생성/완료 E2E는 승인된 새 schema와 테스트 계정/데이터 경계 준비 후 가능하다.
- Expo config 실제 실행 확인: 이름 `업무수첩 QA`, package `com.cetin072.worklog.qa`, scheme `worklog-qa`, version `0.1.0`, versionCode `12`.
- 사용자 설치용 artifact는 **`worklog-mobile-auth-ux-arm64-apk`**다. `worklog-physical-qa-bundle`은 `EXPO_PUBLIC_ANDROID_TOUCH_SMOKE=1` 합성 홈용이므로 일반 사용자 QA 설치본으로 전달하지 않는다.
- 기존 QA 설치본 versionCode·서명은 미확인이다. 같은 signer와 업데이트 가능한 code를 확인하고 다르면 삭제/초기화 없이 해결한다. Play 서명/정식 package는 사용하지 않는다.

기존 workflow는 패치 PR에서 APK job을 건너뛰고 수동 dispatch 때만 생성한다. 이번에는 dispatch하지 않았다. 향후 한 번 누적 제작 후 APK SHA-256, `apksigner verify --print-certs`, manifest package/versionCode, qa-build-info.json의 sourceSha/apiBaseUrl을 함께 기록한다. workflow가 생성한 소스 archive의 SOURCE_SHA 및 CI_CHECKOUT_SHA도 비교한다.

설치 전 후보 APK 인증서와 기존 설치본 인증서 일치를 확인한다. 설치 후 기존 기록 유지, 등록→홈/다른 월→완료/Undo→재시작, OS 알림 전달/취소, 오프라인·중복 터치·계정 전환, 긴 제목/320·390/시스템 글자 확대/키보드, 녹음·사진·Google 명시 전송·수정/삭제를 검수한다. ERP의 실제 읽기 표시와 앱 이동, #490의 AC-13/20은 이 검수 뒤에만 완료 판정한다.

## 현재 실행 가능 범위

코드와 격리 자동검사는 실행 가능하다. DB 적용 계획과 APK 입력은 준비했지만 원격 backup/복원 확인, DB 적용 승인, QA 서버 404 해소, 빌드 승인, 설치본 서명 확인이 남아 있다. 새 APK나 운영 배포가 완료된 상태가 아니다.
