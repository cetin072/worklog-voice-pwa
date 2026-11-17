# 개인 업무 폴더 · 오늘 하기 구현 검수

현재 상태(후속 승인 반영): #548은 main `32130a1`에 병합됐고 운영 additive migration도 적용·검증했다. 아래 초기 Draft/미적용 기록은 당시의 이력이며 최신 결과는 마지막 절을 참조한다.

## 승인 범위와 기준

- 사용자 승인 목업의 구현과 Draft PR 제출만 수행한다. main 병합, 운영 migration, 배포, APK/Play 생성, 실제 사용자 데이터 변경은 승인 범위가 아니다.
- 기준 main: `db25350c18aa73d10a3b0d15b52c8b733b94a817`.
- 착수 시 #540(로그인), #542(통화/OCR), #547(캘린더)은 모두 merged/closed임을 GitHub에서 확인했다. 해당 변경을 포함한 main에서 `feat/personal-work-folders`를 만들었다.
- AGENTS.md, ARCHITECTURE_PRINCIPLES, 제품가치 감사 #494/1차 보고서, 중앙 WEB_ARCHITECTURE_STANDARD를 읽었다. 저장소와 `/workspace/.agents`에 적용할 별도 SKILL.md는 없었다. 최신 사용자 구현 승인을 적용했으며 인증/부팅/Google 세션 코드는 변경하지 않았다.

## 구현과 데이터 경계

- 하단 홈·업무 두 탭. 기록 탭 없음. 업무일지는 설정 안에 유지하고 우상단 설정·내 관리·검색 진입점 유지.
- 개인 폴더 생성·이름 변경·상위/하위 폴더 조회·다른 폴더/최상위로 이동. 경로를 표시하고 이동 대상에서 자신/자손을 제외한다. DB에서도 순환/다른 사용자 폴더 이동을 차단한다.
- 미분류 허용. 기존 날짜 없는 입력을 재사용하며 등록 전에 폴더를 고르지 않는다. 등록 후 업무 탭 미분류에서 원하는 폴더로 이동한다. 예시 사업명이나 공통 폴더를 seed하지 않는다.
- 폴더 내 할 일/메모·자료/완료. 기존 WorkRecord 본문/원문을 펼쳐 읽는다. 업로드나 새 자료 저장소는 만들지 않는다. 업무는 50건씩 추가 조회한다.
- `work_folders`는 개인 폴더, `work_organization`은 WorkRecord ID별 폴더/오늘 선택 정보만 저장한다. institution, WorkRecord 상태/내용/기한, Schedule을 복제하거나 재분류하지 않는다.
- 폴더와 홈 완료는 기존 `completeTaskInline`/Undo API를 사용한다. 홈 ‘오늘 끝낸 일’은 기존 `loadWorkJournalDay → worklog-journal-reader → get_my_work_journal_day`를 그대로 읽는다. 기존 검색과 업무일지도 같은 WorkRecord 상태를 읽는다.
- 일정 원본과 반복 업무 부모는 새 일반 할 일 목록/오늘 선택에서 제외한다. 기존 일정·주간 달력·마감 버킷·반복 요약을 유지한다.
- `mobileTheme` 배경/흰 카드/20px 모서리/남색 버튼을 사용한다. 46px 이상 조작부와 줄바꿈을 적용하고 하단 탭 높이만큼 음성 도크/스크롤 여백을 확보했다.

## 오늘 선택 정책

날짜 없는 미완료 업무만 ‘오늘 하기’로 선택한다. 서버의 서울 날짜를 `selected_on`에 저장하며 `due_at`을 변경하거나 Schedule을 만들지 않는다. 미완료 선택은 다음 날에도 남는다. 완료하면 홈 선택 목록에서 제외되고, Undo하면 다시 나타난다. 선택 해제는 홈 선택만 해제하며 원래 폴더와 기록을 유지한다. 선택된 뒤 기존 편집기로 기한을 추가해도 선택은 유지되며 별도로 해제할 수 있다.

## migration / 보안

파일: `supabase/migrations/20261117112533_personal_work_folders.sql`.

- Supabase CLI `migration new`로 생성했다. CLI v3의 읽기 전용 홈 디렉터리 오류 및 npm v2 설치 실패 후 공식 v2.81.2 바이너리를 `/tmp`에서 사용했다. 연결/운영 적용 명령은 실행하지 않았다.
- 현재 통합 `worklog` schema용 additive migration이다. 기존 데이터 UPDATE/backfill, 기관 분류 변경 없음.
- 두 새 테이블 모두 RLS. 개인 `auth.uid()`와 원본의 개인 workspace 소유권을 검사한다. 복합 FK로 타인 폴더 부모/업무 이동을 차단한다.
- 모든 새 함수는 SECURITY INVOKER, 빈 search_path. anon/PUBLIC 실행을 revoke하고 authenticated에 필요한 권한만 부여한다. 서비스 키를 사용하지 않는다.
- 폴더 그래프 변경은 사용자 단위 advisory transaction lock과 DB trigger로 검사한다. 저장은 version을 확인해 오래된 화면의 덮어쓰기를 거절한다. 폴더 생성 UUID는 응답 유실 재시도에 재사용한다.
- mutation에 화면 소유자 ID를 보내 auth.uid()와 비교하므로 계정이 바뀐 뒤 이전 화면의 요청을 새 계정에 저장하지 않는다.
- 준비되지 않은 DB의 missing RPC/table 오류는 기능 준비 중 안내로 처리한다. 홈/기존 입력/일지의 로딩을 기다리게 하는 전역 초기화 의존성을 만들지 않는다. 요청 timeout, 실패, 재조회, 입력 보존을 처리한다.

## 실제 실행한 검사

- `npm run typecheck --prefix mobile`: PASS. 초기 기존 Expo router.d.ts 캐시가 현재 capture 경로를 모르던 오류는 생성 캐시를 `/tmp`로 옮긴 후 해소했다. 인증/라우트 제품 코드를 고치지 않았다.
- Android Metro export: PASS, `/tmp/worklog-folders-android-final` (설치형 APK가 아닌 JS/Hermes 번들).
- `tests/work-folders-rls.runtime.test.mjs`: 실제 migration을 로컬 PGlite에 실행. 실제 Data Core 테이블/RLS·완료 trigger·업무일지 RPC를 namespace 매핑하여 합성 두 계정으로 검증했다. 선언 schema의 기존 단일 `$` delimiter는 fixture 로딩에서만 정상화했다.
  - 날짜 없는 원본, 미분류→폴더→미분류, 중첩 생성/이름 변경/이동, 직접 DB 수정에서도 순환 거절.
  - today 선택 전후 WorkRecord 전체와 Schedule 전체가 동일함, 날짜 있는 업무/메모/일정/반복 원본의 선택 거절.
  - 이전 날짜의 미완료 선택 유지, 완료 후 폴더 완료·당일 업무일지 일치, Undo 후 복귀, 선택 해제 후 폴더 유지.
  - 로그인 identity 전환 후 지속 조회, 사용자 간 목록/행/이동 격리, 이전 계정 요청 거절, anon 차단, 50건 pagination.
- `tests/mobile-work-folders.runtime.test.mjs`: 실제 TSX handlers/hooks와 RPC adapter를 실행. 경로/이동 후보, 생성/이름 변경/업무 이동, 빠른 연속 탭 1회 저장, 실패 시 편집 유지, 오래된 조회 응답 무시, missing migration 안내와 기존 입력 유지, 기존 완료 콜백/일지 연결.
- `tests/mobile-work-navigation.runtime.test.mjs`: 실제 하단 JSX에 홈/업무만 존재하고 기존 guarded navigation으로 이동함을 실행 검사. safe-area와 도크 여백은 소스 계약 검사.
- `npm test`: **1,370 PASS, 0 FAIL** (최종 실행 약 48초). 기존 홈·음성·직접 입력·설정·알림·일정·반복 테스트를 포함한다. 최초 전체 실행의 두 실패는 승인된 탭 여백과 Undo 공통 위치를 예전 테스트가 가정해서 발생했으며, 해당 harness/계약을 실제 구조에 맞추고 관련 40건 통과를 확인했다.

## 미확인 / 제한

- PGlite는 합성 SQL 검증이다. 운영 PostgREST/RLS catalog, 실제 계정 로그인·재로그인, 운영 저장/재조회 성공을 검증한 것이 아니다. 실제 동시 다중 DB 세션 경합은 미검증이며 lock/버전 경계를 코드와 순차 SQL에서 확인했다.
- native component harness는 실제 React Native 기기 렌더러가 아니다. 320/390px 실기기 시각/키보드/긴 목록·Undo 접근성, 터치·음성·알림 실제 전달은 미검수다.
- Expo web export는 기존 `mobile/package.json`에 `react-native-web`이 없어서 실패했다. 이번 PR에서 의존성/웹 프레임워크를 추가하지 않았다. 레거시 PWA 파일은 변경하지 않았으며 Expo web 실행 가능성을 주장하지 않는다.
- 새 migration을 적용하지 않은 운영 환경에서는 새 폴더 기능이 활성화되지 않는다. 앱 바이너리도 배포되지 않았다.
- 자동검사 통과는 사용자의 실제 업무시간 절감을 입증하지 않는다. 기존 방법 대비 시간·탭 수 실측은 미측정.

## 운영 반영 전 확인 / 별도 승인

1. Draft PR의 최종 SHA CI와 코드/RLS 검토, 사용자 main 병합 승인. 미병합 기능이므로 로컬 패치노트에는 아직 추가하지 않았으며 병합 시 갱신한다.
2. 승인된 격리 DB에서 migration, authenticated PostgREST 호출, 실제 두 계정 격리/재로그인/새로고침, 다중 세션 동시 폴더 이동 검수. DB advisor와 기존 worklog schema/RPC grant/RLS 조건도 확인한다.
3. 320/390px 및 긴 업무명/폴더 경로·50건 이상 목록·키보드·홈/업무 왕복·완료/Undo·미적용 DB fallback, 기존 음성 도크/직접 입력/검색/일정/반복/설정/내 관리 사용자 수용 검수.
4. 운영 DB migration 적용은 별도 승인 후에만 수행. 앱/server 배포 및 요청된 QA APK/Play 출시도 별도 승인. main 병합만으로 운영 활성화를 완료했다고 보고하지 않는다.
5. 웹 대상이 Expo web인지 기존 PWA인지 확정하고 해당 실행 검수를 완료한다. Expo web 지원 확대는 이번 PR 범위를 넘는 의존성 검토가 필요하다.

## 2026-11-17 후속 안전검수와 승인 갱신

사용자가 ‘나머지도 다하고 병합’, ‘그리고 apk까지 해보자’라고 승인했다. 최신 main `7abce5f`(#549 부팅 개선 포함)을 통합했다. 최초 1,370건은 같은 HEAD로 반복하지 않았고 통합 지점과 새로 발견한 결함의 관련 26건을 실행해 모두 통과했다. 통합 TypeScript도 통과했다.

GitHub connector의 전체/수동 workflow 목록을 확인했다. 이번 변경의 기존 Mobile App #883/UAR #1061 성공을 재사용했고, 착수 시 진행 중인 APK 작업은 없었다. 가장 최근 수동 Mobile App 빌드는 2026-11-14 `43581566334`, SHA `f4b53f2`로 이번 폴더 변경을 포함하지 않는다.

### 실제 PostgreSQL/PostgREST 검사 — 16 PASS

독립 로컬 Docker network + tmpfs PostgreSQL 17.12 + PostgREST 12.2.12를 사용했다. HTTP는 localhost에만 노출했으며, 가상의 두 계정 JWT와 실제 authenticated/anon DB role을 사용했다. 호스팅 DB 생성, 운영 계정·기록 사용 없음.

- 실제 HTTP에서 anonymous 접근 거절, 각 사용자 목록 격리, 타인 폴더/업무 접근 및 직접 REST insert 거절, 계정 전환 후 이전 요청 거절.
- 동시에 반대 방향으로 이동하는 두 RPC 중 하나만 성공하고 나머지는 FOLDER_CYCLE로 거절. 직접 REST PATCH로 같은 경쟁을 일으켜도 하나만 성공.
- 같은 WorkRecord/version에 동시에 두 이동 요청을 보내 한 건 성공·한 건 HTTP 409 충돌을 확인.
- 오늘 선택, 폴더 이동, 원본 due_at 불변, 다른 사용자 today 목록 격리 확인.
- 결과: `docs/operations/evidence/work-folders-postgrest-2026-11-17.json`.

**발견/수정한 실제 결함:** 업무 버전 충돌에 SQLSTATE `40001`을 쓰면 PostgREST 12.2.12가 transaction 재시도를 계속하여 HTTP 요청이 timeout됐다. 저장 덮어쓰기는 거절됐지만 충돌 안내가 지연됐다. 새 폴더 RPC의 업무 충돌만 `PT409`로 바꾸고 모바일에서 이를 구분하도록 수정했다. 동일 동시 요청은 즉시 204/409로 종료했다. 실제 DB와 adapter 테스트에서 PT409를 고정한다. [PostgREST custom HTTP errors](https://docs.postgrest.org/en/v12/references/errors.html#raise-errors-with-http-status-codes).

### 화면 실행 제한

Android emulator/adb는 이 환경에 없다. Chromium은 설치돼 있지만 sandbox를 켠 실행이 `SUID sandbox helper ... not configured correctly`로 중단됐다. `--no-sandbox`, 시스템 권한 변경, 보안 우회는 하지 않았다. 따라서 320/390px 시각·키보드·긴 목록에서의 Undo 접근성은 여전히 실측 미검증이다. TSX harness와 safe-area 정적 계약 통과를 실기기 PASS로 바꾸지 않는다.

### 운영 DB 사전 확인

공유 프로젝트 `jgsxpdflgkqroecfjzxq`에서 카탈로그만 읽었다. 대상 `work_folders`, `work_organization`, `save_my_work_folder`는 아직 존재하지 않고, 원본 `work_records`와 `repeating_work`는 존재한다. migration은 기존 데이터/함수 수정 없이 새 테이블·함수만 추가한다. 기존 보안 advisor를 조회했지만 공유 DB 전체의 기존 경고를 이 기능의 새 결함으로 분류하거나 타 서비스 권한을 변경하지 않는다.

운영 backup/PITR 상태는 연결된 도구에서 확인할 수 없어 확인을 요청했다. 복구 지점이 확인되기 전 운영 migration은 적용하지 않는다. 그동안 코드 병합과 QA APK 준비는 독립 진행 가능하며, DB 미적용이면 새 폴더 기능은 준비 중 안내로 남는다. Play 업로드/출시는 실제 기기 QA 전 실행하지 않는다.


## 병합 및 운영 DB 반영 결과 (2026-11-17 12:42 UTC)

- 최종 PR HEAD `bf57882`의 Mobile App #890 (`44084923261`)와 UAR #1066 (`44084923226`) 및 Preview SUCCESS 후 사용자 승인에 따라 main `32130a13689f7a6b1a4ffc26b02449a01dbaf75f`에 병합했다. 보호 규칙 우회나 자동 병합 사용 없음.
- 운영 전체 PITR 상태는 여전히 미확인이다. 다만 이번 변경이 참조하는 원본 4개 테이블(work_records/workspaces/schedules/repeating_work)의 일관된 읽기 전용 scoped snapshot과 실제 컬럼 metadata를 비공개 로컬 경로 `/workspace/worklog-private-backups/pr548/referenced-data.json`에 저장했다. 디렉터리 0700, 파일 0600. SHA256 `91d0979852943629397613cbab9f4dad876d2af20ad0f101c9c991e451d889bb`. 원본 데이터는 GitHub나 공개 산출물에 포함하지 않았다.
- snapshot JSON·컬럼 호환성·행 수를 검증했다. 복구는 신규 기능의 authenticated 권한만 회수하고 신규/원본 데이터를 모두 보존하는 방식이며 로컬 합성 DB에서 회수→transaction rollback→권한 복원 검사를 통과했다. 원본 전체를 덮어쓰는 자동 복원은 하지 않는다. 이는 전체 공유 DB 재해복구/PITR 검증을 뜻하지 않는다.
- 대상 신규 객체 부재와 기존 원본 schema/RLS 전제, 5초 lock timeout/30초 statement timeout을 확인하고 `personal_work_folders` additive migration을 적용했다. 기존 테이블 UPDATE/변환 및 실제 사용자 QA 쓰기 없음.
- 도구가 생성한 실행 이력 version `20261117124209`는 이번 신규 이력 한 행만 저장소의 기존 migration version `20261117112533`으로 정렬했다. name과 미존재 version 조건을 확인했으며 재적용/기존 migration 변경은 하지 않았다.
- 적용 전후 기존 4개 테이블의 전체 행 hash와 행 수가 동일함을 확인했다. 신규 두 테이블은 0행, RLS enabled, 네 RPC SECURITY INVOKER, anon EXECUTE 없음, authenticated EXECUTE 있음. 새 기능 관련 보안 advisor 지적 없음.
- QA APK 빌드와 실제 기기 결과는 별도로 보고한다. 본 운영 DB 반영이 APK/Play 출시를 뜻하지 않는다.
