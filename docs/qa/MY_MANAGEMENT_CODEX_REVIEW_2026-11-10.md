# 내 관리 Codex 인수 검수 — 2026-11-10

기존 구현을 이어받아 원격 참조·PR·공유 DB metadata와 남은 화면 검수를 확인했다. 다른 ChatGPT 작업을 재개하지 않았다. 운영 DB DDL/DML, APK 제작/설치, main 병합, 운영/Play 배포는 실행하지 않았다.

## 소스와 변경 보존

- 최신 main: `5fb97f089b5b98a949f6b36963a4a02b0a2262bb`. 인계 기준과 동일.
- 최초 PR head: #534 `6a611601c1939fecd0cd02982c7200418e11b751`, #535 `6244bfcc001f5a9d4e728af14296f8b3f88c5499`, #536 `d65a00b27cda2d826502c179599f6e492008104a`, #537 `edf4e39c6c13c476d1470670a2ebe9ea1baacd1d`. 모두 Draft/open·미병합으로 확인했다.
- 원래 로컬 main은 오래된 checkout이고 미추적 `.worktrees/`, `supabase/`, `docs/PRODUCTION_DATA_CORE_CUTOVER.md`가 있었다. 해당 checkout과 다른 작업자의 worktree는 수정하지 않았다.
- 별도 관리 worktree의 로컬 브랜치: `codex/my-management-review`. 기존 #537 계열을 이어받았다. 새 제품 PR을 만들지 않는다.
- 제품 수정: 정기지출 긴 제목과 금액이 좁은 행에서 서로 폭을 빼앗지 않게 줄바꿈 허용. 기존 #534에 `afb0bc9a9b3b215f8f7a1c861cc83d5b1a71873d`로 반영했다. 통합본의 동일 수정은 `5f6b69bd7495d6f34297f558c6444d5e94fe1589`.
- 통합 수정: 반복업무 패널의 초기 로딩/조회 실패/실제 빈 목록 구분, 같은 화면의 재확인 버튼. 통합 코드·검수 도구 커밋: `cc496375190dfac4863dbc1d0ee4f59b285b6282`.
- QA 도구: 실제 index.tsx의 반복 패널을 추출해 렌더링하고, 긴 이름·빈 목록·오류·로딩 fixture를 추가했다. RN 기본 실선 border와 Button 글자 확대도 DOM 변환에 반영했다. 실제 앱에 추가되는 런타임 의존성은 없다.

## 자동검사 — 계층을 구분한다

인계 통합 SHA의 Node 1,305 PASS, TypeScript, Android Metro, 격리 PGlite 결과는 기존 기록으로 유지한다. 변경되지 않은 전체 검사를 다시 실행하지 않았다.

이번 선별 검사에서는 **고유 테스트 100개 PASS, 1개 환경 차단**이다.

1. 직접입력/암호화 초안, 홈·달력, Google 연결/수동 전송, 검색/수정, 계정/알림 정리, 정기지출 저장/알림, 습관 터치, 반복 계산/저장/알림, 통합 배치 등 20개 파일 실행: **92 PASS / 1 FAIL**.
2. 실제 내 관리 뒤로가기와 Google 설정 진입·기존 수정/삭제 검증 추가 실행: 9 PASS. 이 중 패널 상태 1개는 1번과 중복이므로 고유 PASS는 100개다.
3. FAIL은 `mobile-gallery-smoke-selector.test.mjs`의 Git Bash/Python 실행 환경이다. 기본 환경은 bash 탐색/샌드박스 차단, Git Bash 경로를 명시해 샌드박스 밖에서 재실행하면 **`python3: command not found` (127)**. 사진 선택 제품 결함으로 확정하지도, PASS/skip으로 숨기지도 않는다. 기존 Linux CI의 합성 XML PASS와 실제 Android 사진 선택 실패/미재검수는 각각 보존한다.
4. 최종 제품 코드에서 `mobile/npm run typecheck`: PASS. `git diff --check`: PASS.

실제 index.tsx의 패널 JSX를 실행해 로딩/빈 목록/실패·재확인 콜백을 확인했다. 실제 뒤로가기 effect도 실행하여 홈/설정 진입점 복귀, 미확정 음성 보호를 확인했다. 브라우저 HTML의 버튼은 정적 fixture이며 탭·저장·취소 동작 성공 근거로 쓰지 않는다.

[기존 통합 CI 42736466590](https://github.com/cetin072/worklog-voice-pwa/actions/runs/42736466590)의 job을 다시 조회했다. changes/typecheck는 success, android-runtime-smoke/android-standalone/android-physical-qa-apk는 **skipped**다. 새 head의 결과는 해당 head CI에서 별도 확인해야 한다.

## 화면 근거와 제한

ego-browser에서 production TSX를 합성 native host→HTML로 변환한 **16종 × 320/390px × 글자 1/2배 = 64개** 조합을 렌더링·PNG 저장했다. 화면 밖 가로 넘침/검사 대상 control overflow 자동 탐지는 64개에서 0건이다. 이 숫자는 가독성·Android 화면 전체 PASS를 뜻하지 않는다.

실제로 확인한 문제:

- 긴 정기지출 이름이 금액 옆에서 매우 좁아져 세로로 길게 배치됐다. `rowTop.flexWrap`과 제목의 유연한 기준 폭을 추가했다. 폰트·색·아이콘·기본 간격은 유지했다.
- 글자 2배에서는 요약 금액의 숫자 중간 줄바꿈, 긴 습관 이름을 반복하는 버튼 등 가독성 확인점이 있다. HTML은 RN의 numberOfLines/Yoga/폰트 측정/키보드를 완전히 재현하지 않으므로 이 결과만으로 글자 크기를 줄이거나 네이티브 화면 PASS를 주장하지 않는다.
- 반복업무 실패 화면에서 빈 목록 안내가 사라지고 오류와 재확인이 보이는 것을 캡처했다.

선별 근거는 [assets 폴더](assets/my-management-2026-11-10/)에 보존한다. **64개 캡처는 패널 상태 수정 후·마지막 정기지출 스타일 수정 전 근거**다. 스타일 변경 후 HTML은 재생성했으나 추가 로컬 파일 화면 접근이 Browser Use URL 정책에서 차단돼 최종 After 재캡처는 완료하지 못했다. 다른 브라우저/우회 서버로 정책을 우회하지 않았다. Android 실제 화면과 최종 스타일 After 확인은 남아 있다.

- [반복 오류·재확인 320px/2배](assets/my-management-2026-11-10/recurring-error-320-2.png)
- [긴 반복 제목 320px/2배](assets/my-management-2026-11-10/recurring-long-320-2.png)
- [긴 정기지출 제목 — 수정 전](assets/my-management-2026-11-10/expenses-long-before-layout-320-2.png)
- [긴 습관 제목 390px/2배](assets/my-management-2026-11-10/habits-long-390-2.png)
- [ERP 인증 경계](assets/my-management-2026-11-10/erp-auth-boundary.png)
- [64조합 기하 검사 결과](assets/my-management-2026-11-10/browser-results.json)

## #490 수용 기준 20개

원본: [확정 수용 기준](https://github.com/cetin072/worklog-voice-pwa/issues/490#issuecomment-6653066442). PASS는 기재한 자동 계층의 근거이며 실제 기기 검수를 대신하지 않는다. `미실행`은 필요한 실제 UI/기기 조합을 아직 수행하지 않은 경우, `차단`은 서버·인증·승인 선행 조건이 없는 경우다. 격리 SQL 근거는 변경되지 않은 기존 `recurring-rls.test.mjs` 실행 기록을 재사용했다.

| AC | 판정 | 확인한 근거 / 남은 조건 |
|---|---|---|
| 01 | 미실행 | 직접입력 실제 HTTP·초안·반복 연결 실패 보존 PASS. 음성·사진·기존 상세 전환의 Android 전체 흐름 미실행. |
| 02 | 미실행 | recurrence-model/store의 90일·월 이동 계산·무쓰기 PASS. 매월10일 등록부터 실제 홈/다른 월 조회까지 UI 흐름 미실행. |
| 03 | PASS (자동) | 매일·월/금 복수요일·격주·연 반복, 동일 회차 키 계산 검사. |
| 04 | PASS (자동) | 월31 말일 보정과 31일 복귀, 평년/윤년 2/29 연 반복 검사. |
| 05 | 미실행 | 8주 미완료·다음 회차 독립 계산 PASS. 실제 홈 최근3+더보기에서 나머지5개 개별 처리 미실행. |
| 06 | 미실행 | 단일 날짜 이동의 키 보존·다음 월 불변, 미래 revision 과거 보존 계산 PASS. 이번 회차/앞으로 전체의 UI 저장·취소 조합 미실행. |
| 07 | 미실행 | SQL 완료/Undo와 가짜 OS 예약 정합성 PASS. 실제 기기 예약 취소/복원 미실행. |
| 08 | 미실행 | 건너뜀·중지/재개 미소급·종료 이력의 계산/SQL 근거. 상세 UI 전체 조합 미실행. |
| 09 | PASS (자동) | 11/5 예정→11/8 완료→12/8, Undo 회차 복원 계산. SQL 실제 완료일 기반 다음 회차와 Undo 근거. |
| 10 | PASS (자동) | 간격형 skip은 다음 날짜 미확정, 직접 지정 후 다음 완료에서 간격 재계산; SQL 후속 처리 후 과거 Undo 차단. |
| 11 | 미실행 | summary의 과거 미완료·미래 제외·마지막 완료/다음 예정 계산 근거. 앱 재시작 후 실제 상세 이력 조회 미실행. |
| 12 | 미실행 | 실제 알림 adapter+가짜 OS에서 중복/중지/logout/owner 유지 PASS. Android 전달·재시작 복구 미실행. |
| 13 | 차단 | readRepeatingMonth 계약·격리 SQL owner/권한 회수·readonly PASS. 원격 RPC 없음, ERP는 로그인 화면. 실제 표시·업무수첩 이동 미확인. |
| 14 | PASS (자동/코드) | 반복 변경에서 Google 자동 전송/폐기 웹 Push 호출 추가 없음. Google 수동 전송의 동의·취소·다중 터치 회귀 PASS. |
| 15 | PASS (격리 SQL) | 같은 요청 10회가 같은 영수증/회차 결과 반환. 습관 화면 실제 TSX 10터치도 1요청. Android 반복 완료 터치는 AC20에서 별도 확인. |
| 16 | PASS (자동) | 응답 유실 후 같은 UUID 영수증 확인, 확인 불가/계정 변경에서 성공 금지. 직접입력 원문·요청 유지 검사. |
| 17 | PASS (격리 SQL/자동) | 예상 버전 충돌 거부·다른 기기 안내·재조회, 늦은 목록이 확인된 버전을 덮지 않는 훅 검사. |
| 18 | 차단 | 격리 SQL의 owner/타인/anon/권한 회수 PASS. 원격 적용 전 백업·복구 준비 및 승인 미완료. 원격 사용자 행 시험 없음. |
| 19 | 미실행 | 선택한 기존 직접입력/수정·삭제/Google 설정·전송/검색/알림 회귀 PASS. 사진 XML은 환경 차단, 녹음·사진·인증·알림 실기기 미실행. |
| 20 | 미실행 | 이번 통합 SHA APK 없음. 제작/설치 범위 승인 및 exact-head artifact·기기 E2E 필요. |

20개 전체 PASS 또는 출시 준비 완료로 표시하지 않는다.

## 공유 DB 읽기 전용 재확인과 적용 계획

대상 프로젝트 `jgsxpdflgkqroecfjzxq` / `taejang-phase1-staging` (ERP와 운영/QA가 공유). 프로젝트 목록, migration 목록, `to_regclass/to_regprocedure` metadata만 읽었다. 실제 사용자 행을 조회하거나 시험 쓰기하지 않았다.

| migration | 현재 |
|---|---|
| 20261109125845 subscriptions_v1 | 적용됨, 재적용 금지 |
| 20261109144344 subscriptions_payment_method | 적용됨, 재적용 금지 |
| 20261109232907 regular_expenses_v1 | 미적용, subscription_payments 없음 |
| 20261109233147 repeating_work_v1 | 미적용, repeating_work와 ERP 월 조회 RPC 없음 |
| 20261109234334 habits_v1 | 미적용, habits 없음 |

향후 별도 승인 전 준비/보고할 항목:

1. 같은 프로젝트 ref·schema·기존 migration의 version/name을 다시 확인하고 신규 3개 SQL digest를 확정한다. 이미 존재하면 중단하고 이력과 실제 객체 차이를 먼저 검토한다.
2. 영향은 subscriptions 확장/납부 이력, 반복 규칙·영수증·RPC·RLS 및 **기존 work_records 보호 trigger**, 습관 설정·체크·영수증이다. 원본 trigger는 구버전 앱의 일반 완료/수정에 409 안내를 유발하므로 클라이언트 호환성과 연관 업무 경로를 사전 검토한다.
3. 적용 직전 schema/function/trigger/grant 정의와 공급자의 사용 가능한 backup/PITR·복원 지점/절차를 확인한다. 필요 데이터 backup은 승인된 비공개 저장 위치와 보관·복구 검증을 먼저 정한다. 이 작업에서는 backup 존재·복구 성공을 가정하거나 운영 데이터를 복사하지 않았다.
4. 동일 SQL의 격리 DB/RLS/기존 업무 회귀를 후보 SHA로 확인하고, 승인된 트랜잭션 단위로 적용한다. 오류 시 실패 중단/rollback하며 일부 적용 상태를 성공으로 보고하지 않는다.
5. 복구는 새 기능 진입 중단·직전 클라이언트/API 복귀를 먼저 검토한다. trigger/RPC의 이전 정의 복원도 별도 승인 후 수행한다. 새 이력 테이블을 DROP하거나 운영 기록을 초기화하는 방식은 사용하지 않는다.

## APK 제작 계획 — 실행 안 함

- 검토 후보 소스는 통합 코드 커밋 `cc496375190dfac4863dbc1d0ee4f59b285b6282`와 이후 이 보고서 커밋을 포함한 #537 head다. **전체 QA checkpoint는 main 병합 대상이 아니다.** 기록/계정·알림 감사, #525/#532, 다른 미병합 변경을 포함하므로 제품 PR과 QA 전용 변경을 분리 검토한다.
- 빌드 직전 #537 원격 head 40자리 SHA를 다시 고정하고 checkout SHA·서버 배포 SHA를 각각 기록한다. workflow_dispatch는 mutable branch를 받으므로 완료 후 artifact의 실제 sourceSha가 의도한 SHA와 같은지 검증한다.
- 서버 후보: `https://deploy-preview-537--worklog-voice-pwa.netlify.app`, `EXPO_PUBLIC_API_BASE_URL`로 명시. 현재 해당 배포의 SHA/접근 가능 여부는 미확인이다. `/api/supabase-auth-config`의 프로젝트 host와 `dataSchema=worklog`를 비밀값 출력 없이 확인해야 한다. QA 패키지도 공유 운영 DB를 사용하므로 Preview 주소만으로 데이터 격리가 되지 않는다.
- 패키지: `com.cetin072.worklog.qa`; 이름 업무수첩 QA; scheme `worklog-qa`; Play 패키지 `com.cetin072.worklog`와 분리.
- 현재 config의 QA versionCode는 `max(12, app.json의 1)=12`. **기존 설치본 versionCode/서명은 미확인**이다. 사용자의 기기 검수 범위 승인 후 adb package metadata와 인증서 SHA-256을 읽고, 업데이트 가능한 versionCode·동일 signer를 확인한다. 불일치를 앱 삭제/초기화로 해결하지 않는다.
- 서명: workflow는 Play 서명 환경을 켜지 않고 prebuild→assembleRelease 경로를 사용한다. 실제 APK의 인증서와 설치본 일치 여부는 제작 전에는 확정할 수 없다. `apksigner verify --print-certs`, manifest package/versionCode와 APK SHA-256을 artifact 보고서에 포함한다.
- 승인 후 기존 `Mobile App` workflow의 명시 `build_android=true` 경로로 누적 후보를 한 번 제작한다. 지금은 dispatch하지 않았다. 별도 Physical Device Gate도 아직 실행하지 않았다.
- 실제 기기 수용: 기존 QA 데이터 유지, 320/390 및 시스템 글자 확대, 긴 이름/빈 목록/오류/반복 터치/수정/취소/뒤로가기, 등록→홈/다른 월→완료/Undo→재시작→알림, Google 설정/명시 전송, 기존 연필·직접입력·녹음·사진·검색, ERP 읽기 전용/앱 이동/다른 계정 차단.
- 새 schema가 없는 현재 공유 DB에서는 정상 생성·완료 E2E가 차단된다. 운영 migration 승인을 대신 가정하지 않으며, 격리 서버를 사용할지 공유 DB migration을 별도로 승인받을지 결정한 뒤 end-to-end 범위를 확정해야 한다.

## 현재 결론

코드와 합성 화면 검수를 이어받아 국소 수정 2건을 수행했다. 운영 데이터 변경·배포 없이 검토 가능한 상태로 보존했다. 최종 스타일 After 캡처, Python 환경의 사진 XML 재검사, Android 설치·폰트/키보드·알림·녹음/사진 실기기와 ERP 인증 후 통합은 남아 있다. 실제 사용자 업무시간 절감은 측정하지 않았다.
