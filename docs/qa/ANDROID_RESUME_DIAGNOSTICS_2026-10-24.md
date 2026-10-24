# 재개 진단 — 2026-10-24

기존 API/다운로드 실패 요청을 재전송하지 않고 로그·환경·로컬 capability를 조사했다.

## GitHub: 확인된 사실과 확인할 수 없는 사실

- 실행 도구: `functions.exec → exec_command → /usr/bin/gh workflow run`.
- `/usr/bin/gh`는 정상 ELF 바이너리이며 로컬 버전은 2.46.0이다. 임의 wrapper가 아니다.
- 요청: GET `https://api.github.com/repos/cetin072/worklog-voice-pwa/actions/workflows/mobile-foundation.yml`.
- 남아 있는 CLI 출력: `Get "https://api.github.com/repos/cetin072/worklog-voice-pwa/actions/workflows/mobile-foundation.yml": Forbidden`.
- `gh workflow run --help`는 workflow filename 및 `--repo`/`--ref`/`-f` 조합을 지원한다.
  로컬 origin/main에도 해당 workflow 파일과 workflow_dispatch/build_android 입력이 존재한다.
  잘못된 파일명/미지원 명령/누락 trigger라는 증거가 없다. 수정 요청 재시도 근거도 없다.
- 인증 범주: 환경 변수 `GH_TOKEN`을 사용하는 표준 GitHub CLI 토큰 인증.
  `GITHUB_TOKEN`, 사용자 hosts.yml, 커스텀 GH_HOST는 없다. 값·토큰 접두사·권한목록은 출력하지 않았다.
- HTTP(S) 프록시가 설정되어 있다. 이 사실만으로 프록시가 거절했다고 단정하지 않는다.
- 원본 HTTP 응답 본문/상태 헤더/debug trace는 저장되지 않았다. 현재 executor log에도 Forbidden 기록이 없다.
  따라서 GitHub 토큰의 저장소/Actions 권한 거절인지, 환경 네트워크 정책인지 확정할 수 없다.
- 결과는 **조회 차단**, dispatch POST 미실행이다. API 재시도·다른 인증/채널 우회 없음.

## Library: 실패 지점과 공식 전달 계약

- 기본/QA prepare_materialize는 정상 성공하여 version 0과 authorized transfer를 반환했다.
- `library_file_transfer.py materialize` 실행에서 exit 1 및
  `library file transfer failed: download failed`가 반환됐다.
- 남은 stderr는 이 한 줄뿐이며 상세 HTTP 원인/trace가 없다. 현재 executor log에도 상세 오류가 없다.
- base 2회, QA 최초+fresh prepare 후 재시도 2회로 bounded retry 소진. 이번 재개에서 다운로드 호출 0회.
- 실제 byte transfer 실패이며 파일 조회 단계 권한 거절은 관측되지 않았다.
  다운로드 단계의 권한 거절/일시 오류 여부는 미확정이다. 자동 승인 심사 거절 메시지는 없었다.
- consumer-local `mobile/assets` 및 제공된 `/workspace/library-files`, `/workspace/shared/downloads`는 비어 있다.
  다른 환경/부모 경로/추정 URL/수동 storage 다운로드를 사용하지 않았다.

공식 resolved-reference 입력은 이미 모두 확보되어 있으며 새 토큰/ID가 필요한 상황은 아니다.

| 용도 | Library ID | file_id | file_name |
|---|---|---|---|
| base | libfile_dcb45eba3ee48191a3072d18e2add6ab | file_00000000ab8c81f5a9c56ea3f910c334 | worklog-launcher-1024.png |
| QA | libfile_2cd16b335b848191b7383ff710fed5e9 | file_00000000f8fc81f5a81318b28cd631d0 | worklog-qa-launcher-1024.png |

정식 계약: `prepare_materialize.items[]`에 같은 버전의 위 식별자/파일명을 전달하고,
`destination.directory=/workspace/worklog-voice-pwa/mobile/assets`를 지정한다.
`workspace_path`가 반환되면 해당 실제 경로에 metadata를 적용하고, signed transfer이면 공식 helper가
완전한 transfer 객체를 입력받아 다운로드·metadata를 처리한다. 이번에는 후자 단계에서 실패했다.

현재 노출 도구에는 다른 환경의 일반 첨부를 이 executor로 직접 복사하는 별도 공식 transfer가 없다.
Gmail/Notion attachment 기능을 무관한 파일 운반 우회로 사용하지 않았다.
새 사용자 첨부를 전달할 경우 플랫폼이 **이 executor에서 읽을 수 있는 실제 파일 경로/첨부 바이트**를
제공해야 하며, 부모 로컬 경로나 동일 Library ID 반복 전달만으로 해결됐다고 가정하면 안 된다.

## Android build capability

- 있음: Node/npm, 설치된 Expo/RN dependencies, JDK 21, Hermes export 및 TypeScript/test 실행.
- 없음: Android SDK, adb, sdkmanager, Android platform/build-tools, 생성된 Android project/Gradle wrapper.
  ANDROID_HOME/ANDROID_SDK_ROOT도 설정되지 않았다.
- onboarding 기록은 npm dependencies 설치만 수행했다. 준비된 APK/SDK나 별도 Android build task는 발견하지 못했다.
- 로컬 native build에는 공식 SDK/platform/build-tools/필요 NDK·Gradle 다운로드와 SDK license 절차,
  디스크/빌드 시간이 추가로 필요하다. 이번 진단에서는 설치/라이선스 승인/credential 생성 없음.
- 기존 CI는 이미 준비된 GitHub runner에서 기존 서명 방식으로 빌드한다. 신규 유료 서비스/실기기 시험은 필요 없다.
  기존 CI의 실행 가능 여부는 아직 API 차단 때문에 검증되지 않았다.
- 설치 인증서 일치 여부는 APK 생성 가능 여부와 별도다. 인증서 확인 전 재설치/삭제 요청 없음.

## 실제 진행한 준비 작업

- `mobile/app.config.js`: WORKLOG_ICON_VARIANT=existing/base/qa 선택.
- existing/미설정은 기존 config를 그대로 유지. base/qa는 승인 파일 부재 시 명시적 실패.
- package/scheme/version/auth/backend 분리 없음. opaque PNG를 transparent foreground로 취급하지 않는다.
- 기존 adaptive override가 있으면 검수 없이 잘못 혼합하지 않도록 중단한다.
- Mobile App workflow의 standalone job은 선택을 prebuild/build에 동일하게 전달한다.
- 가짜 PNG/대체 디자인 생성 없음. 실제 아이콘 적용·adaptive safe-zone/축소 픽셀 검수는 여전히 미완료.
- 전체 테스트 891/891 PASS, TypeScript PASS, 실제 Expo config default 로딩 PASS,
  실제 Expo loader의 base/QA 파일부재 실패 확인, YAML parsing 및 diff-check PASS.
- 별도 reviewer: wiring 독립검수 PASS, 실제 아이콘 적용 PARTIAL; runtime 7/7 PASS.

## PC 없이 확인할 최소 행동 1개

Android Chrome에서 GitHub의
[Mobile App workflow](https://github.com/cetin072/worklog-voice-pwa/actions/workflows/mobile-foundation.yml)를 열어,
`Run workflow`에서 `qa/android-stabilization-20261024` 브랜치를 선택하고 실행한다.
`build_android=true`, 아이콘 선택이 보이면 `existing`을 유지한다. 이 실행은 진단용 코드 빌드이며
아직 새 아이콘이 포함되지 않는다. Firebase Test Lab/Play workflow는 실행하지 않는다.

확인할 결과는 **새 workflow run 번호/링크가 생기는지** 하나다. 생성되면 링크를 전달하면 되고,
버튼이 없거나 오류가 표시되면 그 문구만 전달하면 된다. 앱 설치·데이터 삭제·PC·키 전달은 필요 없다.
main/Production/Play/운영 DB/실제 계정삭제는 계속 제외한다.
